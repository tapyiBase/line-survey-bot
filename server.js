const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const bodyParser = require('body-parser');
const axios = require('axios');
const FormData = require('form-data');

require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

// LINE設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new Client(config);

// JSON用
app.use(bodyParser.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// Webhookエンドポイント（署名検証あり）
app.post('/webhook', middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch((err) => {
      console.error('Webhook error:', err);
      res.status(500).end();
    });
});

// 画像送信用（署名検証なし）
app.post('/sendToGAS', async (req, res) => {
  try {
    const { base64Image, name } = req.body;
    const response = await axios.post(process.env.GAS_ENDPOINT, {
      base64Image,
      name
    });
    res.json({ success: true, url: response.data.imageUrl });
  } catch (err) {
    console.error('GAS連携エラー:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// アンケート処理（例：画像以外）
async function handleEvent(event) {
  if (event.type !== 'message') return;

  const userId = event.source.userId;
  const message = event.message;

  // 画像の場合
  if (message.type === 'image') {
    const content = await client.getMessageContent(message.id);
    const chunks = [];
    for await (const chunk of content) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const base64Image = buffer.toString('base64');

    // ユーザー名取得
    const profile = await client.getProfile(userId);
    const name = profile.displayName || '匿名';

    // GAS送信
    await axios.post(`${process.env.GAS_ENDPOINT}`, {
      base64Image,
      name
    });

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ありがとうございました！写真を受け取りました。'
    });
  }

  // テキストの場合（簡易おうむ返し）
  if (message.type === 'text') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `「${message.text}」を受け取りました。`
    });
  }
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

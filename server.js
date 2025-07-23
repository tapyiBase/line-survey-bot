const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 🔒 LINEチャネル設定
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// 📊 Google Apps ScriptのWebhook URL（GAS側doPost）
const GAS_WEBHOOK_URL = 'https://script.google.com/macros/s/あなたのGASデプロイURL/exec';

// 🔧 rawBodyを取得する設定（署名検証用）
app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// 🔐 LINE署名検証
function validateSignature(rawBody, signature) {
  const hash = crypto.createHmac('SHA256', LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest('base64');
  return hash === signature;
}

// 📩 受信Webhook処理
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  const rawBody = req.rawBody;

  if (!validateSignature(rawBody, signature)) {
    console.log('❌ Signature validation failed');
    return res.status(401).send('Unauthorized');
  }

  const events = req.body.events;
  if (!events || events.length === 0) {
    return res.status(200).send('No events');
  }

  const event = events[0];

  // ここでテキスト送信に対応（任意）
  if (event.type === 'message' && event.message.type === 'text') {
    const replyMessage = {
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: 'メッセージを受け取りました！' }]
    };

    try {
      await axios.post('https://api.line.me/v2/bot/message/reply', replyMessage, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
        }
      });
    } catch (err) {
      console.error('LINEメッセージ送信失敗:', err.response?.data || err.message);
    }
  }

  // 🔁 GASへ送信（例：アンケート終了後など）
  try {
    await axios.post(GAS_WEBHOOK_URL, {
      userId: event.source.userId,
      name: '仮の名前',
      jobType: 'ホールスタッフ',
      area: '新宿',
      days: '週3日以上',
      experience: 'あり',
      pr: 'よろしくお願いします'
    });
  } catch (err) {
    console.error('GAS送信エラー:', err.response?.data || err.message);
  }

  res.status(200).send('OK');
});

// 🚀 起動
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

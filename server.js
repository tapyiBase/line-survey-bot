const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.Client(config);
const GAS_URL = process.env.GAS_URL;

app.post('/webhook', line.middleware(config), async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    if (event.type === 'message') {
      const message = event.message;
      const userId = event.source.userId;

      if (message.type === 'image') {
        try {
          // 一時的な画像URLを取得
          const contentUrl = `https://api-data.line.me/v2/bot/message/${message.id}/content`;
          const headers = {
            Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
          };

          // GASに送信する（GAS側でスプレッドシートに保存）
          await axios.post(GAS_URL, {
            userId: userId,
            imageUrl: contentUrl
          });

          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: '画像を受け取りました！'
          });
        } catch (error) {
          console.error('画像処理エラー:', error);
        }
      }
    }
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at port ${PORT}`);
});

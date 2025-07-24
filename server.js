const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new Client(config);
const app = express();

app.post('/webhook', middleware(config), async (req, res) => {
  console.log('✅ Webhook accessed');
  const events = req.body.events;

  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: `受け取ったメッセージ: ${event.message.text}`
      });
    }
  }

  res.status(200).end();
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`🚀 LINE Bot running on port ${port}`);
});

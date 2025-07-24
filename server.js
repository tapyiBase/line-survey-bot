const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const line = require('@line/bot-sdk');

const app = express();

// LINEの設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

// LINE SDK クライアント
const client = new line.Client(config);

// 🔻 rawBody 保存用のミドルウェア設定
app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf; // Buffer型を保存
  }
}));

// Webhookエンドポイント
app.post('/webhook', (req, res) => {
  // 🔻 署名を検証
  const signature = req.headers['x-line-signature'];
  const isValid = validateSignature(req.rawBody, config.channelSecret, signature);

  if (!isValid) {
    console.log('⚠️ Invalid signature');
    return res.status(403).send('Invalid signature');
  }

  // 🔻 LINEイベント処理
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// 署名検証関数
function validateSignature(body, secret, signature) {
  const hmac = crypto.createHmac('SHA256', secret);
  hmac.update(body);
  const expectedSignature = hmac.digest('base64');
  return signature === expectedSignature;
}

// イベント処理
function handleEvent(event) {
  if (event.type === 'message' && event.message.type === 'text') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `受け取ったメッセージ: ${event.message.text}`
    });
  }
  return Promise.resolve(null);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 LINE Bot running on port ${PORT}`);
});

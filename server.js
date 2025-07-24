const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const bodyParser = require('body-parser');
const app = express();

const LINE_CHANNEL_SECRET = '★チャネルシークレット★';
const LINE_CHANNEL_ACCESS_TOKEN = '★アクセストークン★';
const GAS_ENDPOINT = '★GASのWebhook URL★';

app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

function validateSignature(signature, body) {
  const hash = crypto
    .createHmac('SHA256', LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return signature === hash;
}

app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  const body = req.rawBody;

  if (!validateSignature(signature, body)) {
    console.log('[署名エラー] Invalid signature:', signature);
    return res.status(401).send('Unauthorized');
  }

  const events = req.body.events;
  console.log('受信イベント:', events);

  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;
      const replyToken = event.replyToken;

      if (userMessage.includes('こんにちは') || userMessage.includes('スタート')) {
        await replyMessage(replyToken, {
          type: 'text',
          text: 'アンケートを開始します！\nまずはお名前を教えてください。'
        });
      } else {
        await replyMessage(replyToken, {
          type: 'text',
          text: 'アンケートの回答ありがとうございました！'
        });
      }
    }
  }

  return res.status(200).send('OK');
});

async function replyMessage(token, message) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', {
      replyToken: token,
      messages: [message]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });
  } catch (error) {
    console.error('[送信エラー] LINEへのメッセージ送信失敗:', error.response?.data || error.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

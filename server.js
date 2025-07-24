const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const bodyParser = require('body-parser');
const app = express();

const LINE_CHANNEL_SECRET = '1564c7045280f8e5de962041ffb6568b';
const LINE_CHANNEL_ACCESS_TOKEN = 'vTdm94c2EPcZs3p7ktHfVvch8HHZ64/rD5SWKmm7jEfl+S0Lw12WvRUSTN1h3q6ymJUGlfMBmUEi8u+5IebXDe9UTQXvfM8ABDfEIShRSvghvsNEQD0Ms+vX3tOy9zo3EpJL8oE0ltSGHIZFskwNagdB04t89/1O/w1cDnyilFU=';
const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxDN14UbuIVIXZNj-RWGIE5G6lUqnG6I9AEmsEDNKttEsAGmkCVrd0CscBMdRqiP7AK0Q/exec';

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
      const userId = event.source.userId;

      // GASに送信（記録用）
      try {
        await axios.post(GAS_ENDPOINT, {
          userId: userId,
          message: userMessage,
          timestamp: new Date().toISOString()
        });
      } catch (e) {
        console.error('[GAS連携エラー]', e.response?.data || e.message);
      }

      // アンケート開始トリガー
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

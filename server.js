const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');
const FormData = require('form-data');
const { Buffer } = require('buffer');

const app = express();
app.use(express.json());

// LINE設定
const config = {
  channelAccessToken: 'vTdm94c2EPcZs3p7ktHfVvch8HHZ64/rD5SWKmm7jEfl+S0Lw12WvRUSTN1h3q6ymJUGlfMBmUEi8u+5IebXDe9UTQXvfM8ABDfEIShRSvghvsNEQD0Ms+vX3tOy9zo3EpJL8oE0ltSGHIZFskwNagdB04t89/1O/w1cDnyilFU=',
  channelSecret: '1564c7045280f8e5de962041ffb6568b'
};

const client = new line.Client(config);

// Webhook受信
app.post('/webhook', line.middleware(config), async (req, res) => {
  const events = req.body.events;

  try {
    const results = await Promise.all(events.map(handleEvent));
    res.json(results);
  } catch (error) {
    console.error('エラーハンドリング中に問題が発生:', error);
    res.status(500).end();
  }
});

// イベント処理関数
async function handleEvent(event) {
  if (event.type !== 'message') return Promise.resolve(null);

  const userId = event.source.userId;
  const timestamp = new Date(event.timestamp).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  if (event.message.type === 'image') {
    const messageId = event.message.id;
    const imageBuffer = await client.getMessageContent(messageId).then(streamToBuffer);
    const base64Image = imageBuffer.toString('base64');

    // GASにPOST送信
    const formData = new FormData();
    formData.append('userId', userId);
    formData.append('timestamp', timestamp);
    formData.append('imageData', base64Image);

    const headers = formData.getHeaders();

    await axios.post('https://script.google.com/macros/s/AKfycbxDN14UbuIVIXZNj-RWGIE5G6lUqnG6I9AEmsEDNKttEsAGmkCVrd0CscBMdRqiP7AK0Q/exec', formData, { headers });

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '画像を受け取りました。担当者からの連絡をお待ちください。',
    });
  }

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: '画像を送ってください📷',
  });
}

// ストリームをバッファに変換
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', err => reject(err));
  });
}

// サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`サーバー起動中: http://localhost:${PORT}`);
});

const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Render側の環境変数に合わせて読み込み
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const GAS_ENDPOINT = process.env.GAS_ENDPOINT;

const config = {
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: LINE_CHANNEL_SECRET
};

const client = new line.Client(config);
const app = express();
app.use(express.json());

// LINEからのWebhookを処理
app.post('/webhook', line.middleware(config), async (req, res) => {
  const events = req.body.events;
  if (!Array.isArray(events)) return res.status(500).end();

  const results = await Promise.all(events.map(async (event) => {
    if (event.type === 'message') {
      if (event.message.type === 'text') {
        return handleText(event);
      } else if (event.message.type === 'image') {
        return handleImage(event);
      }
    }
  }));

  res.json(results);
});

// 質問管理
const userAnswers = {};

async function handleText(event) {
  const userId = event.source.userId;
  const text = event.message.text.trim();

  if (!userAnswers[userId]) {
    userAnswers[userId] = [];
  }

  const currentIndex = userAnswers[userId].length;

  const questions = [
    '本名（氏名）を教えてください。',
    '面接希望日を教えてください。（例：7月25日 15:00〜）',
    '経験はありますか？（あり / なし）',
    '過去に在籍していた店舗名があれば教えてください。',
    'タトゥーや鯖（スジ彫り）はありますか？（あり / なし）',
    '顔写真または全身写真の画像を送ってください。'
  ];

  if (currentIndex === 5) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '顔写真または全身写真の画像を送ってください。'
    });
  }

  userAnswers[userId].push(text);

  if (currentIndex + 1 < questions.length) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: questions[currentIndex + 1]
    });
  } else {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '画像をお送りください！'
    });
  }
}

// 画像処理
async function handleImage(event) {
  const userId = event.source.userId;
  const messageId = event.message.id;

  try {
    const stream = await client.getMessageContent(messageId);
    const tempPath = path.join(__dirname, `${uuidv4()}.jpg`);
    const writable = fs.createWriteStream(tempPath);

    await new Promise((resolve, reject) => {
      stream.pipe(writable);
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    const imageData = fs.readFileSync(tempPath);

    const form = new FormData();
    form.append('userId', userId);
    form.append('image', imageData, { filename: 'image.jpg', contentType: 'image/jpeg' });
    form.append('answers', JSON.stringify(userAnswers[userId] || []));

    await axios.post(GAS_ENDPOINT, form, {
      headers: form.getHeaders()
    });

    fs.unlinkSync(tempPath);

    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ご回答ありがとうございました！内容を確認して担当者よりご連絡いたします。'
    });

    delete userAnswers[userId];
  } catch (err) {
    console.error('画像処理エラー:', err);
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '画像の処理に失敗しました。もう一度お試しください。'
    });
  }
}

// サーバー起動
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`LINE bot is running on port ${port}`);
});

// server.js
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.Client(config);

// Use raw body for signature validation
app.post('/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const signature = req.headers['x-line-signature'];
  const body = req.body;

  // Validate signature
  if (!line.validateSignature(body, config.channelSecret, signature)) {
    return res.status(401).send('Unauthorized');
  }

  const events = JSON.parse(body.toString()).events;

  Promise
    .all(events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// 質問の定義
const questions = [
  {
    text: 'ご希望の日付を選択してください',
    type: 'date'
  },
  {
    text: 'ご希望の時間帯を選択してください',
    type: 'time'
  },
  {
    text: '本名（氏名）を教えてください',
    type: 'text'
  },
  {
    text: '経験はありますか？',
    type: 'select',
    options: ['あり', 'なし']
  },
  {
    text: '過去に在籍していた店舗名があれば教えてください',
    type: 'text'
  },
  {
    text: 'タトゥーや鯖（スジ彫り）はありますか？',
    type: 'select',
    options: ['あり', 'なし']
  },
  {
    text: '顔写真または全身写真を送信してください',
    type: 'image'
  }
];

// ユーザーの状態管理
const userStates = new Map();

async function handleEvent(event) {
  if (event.type !== 'message') return null;

  const userId = event.source.userId;
  const userState = userStates.get(userId) || { answers: [], step: 0 };
  const currentQuestion = questions[userState.step];

  // 画像送信対応
  if (currentQuestion && currentQuestion.type === 'image' && event.message.type === 'image') {
    const imageUrl = await downloadAndUploadImage(event.message.id);
    userState.answers.push(imageUrl);
    userState.step++;
  } else if (event.message.type === 'text') {
    userState.answers.push(event.message.text);
    userState.step++;
  }

  if (userState.step < questions.length) {
    await sendQuestion(userId, questions[userState.step]);
  } else {
    await saveToGAS(userState.answers, userId);
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ご回答ありがとうございました！内容を確認して担当者よりご連絡いたします。'
    });
    userStates.delete(userId);
  }

  userStates.set(userId, userState);
}

async function sendQuestion(userId, question) {
  let message;
  if (question.type === 'select') {
    message = {
      type: 'text',
      text: question.text,
      quickReply: {
        items: question.options.map(opt => ({
          type: 'action',
          action: {
            type: 'message',
            label: opt,
            text: opt
          }
        }))
      }
    };
  } else {
    message = { type: 'text', text: question.text };
  }
  await client.pushMessage(userId, message);
}

async function saveToGAS(answers, userId) {
  const url = process.env.GAS_ENDPOINT;
  await axios.post(url, { userId, answers });
}

async function downloadAndUploadImage(messageId) {
  const stream = await client.getMessageContent(messageId);
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', async () => {
      const buffer = Buffer.concat(chunks);
      const base64Image = buffer.toString('base64');
      const imageUrl = await uploadImageToImgur(base64Image);
      resolve(imageUrl);
    });
    stream.on('error', reject);
  });
}

async function uploadImageToImgur(base64Image) {
  const res = await axios.post('https://api.imgur.com/3/image', {
    image: base64Image,
    type: 'base64'
  }, {
    headers: {
      Authorization: `Client-ID ${process.env.IMGUR_CLIENT_ID}`
    }
  });
  return res.data.data.link;
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

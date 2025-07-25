const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');
const bodyParser = require('body-parser');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 10000;

app.use(bodyParser.json({ verify: (req, res, buf) => { req.rawBody = buf } }));

// LINE設定
const config = {
  channelAccessToken: '【LINE_CHANNEL_ACCESS_TOKEN】',
  channelSecret: '【LINE_CHANNEL_SECRET】'
};

const client = new line.Client(config);

// 状態管理
const userStates = {};  // userId: { step: 0, answers: {} }

// 質問一覧
const questions = [
  { key: 'name', text: '本名（氏名）を教えてください。' },
  { key: 'interview', text: '面接希望日を教えてください。（例：7月25日 15:00〜）' },
  { key: 'experience', text: '経験はありますか？', options: ['あり', 'なし'] },
  { key: 'pastShop', text: '過去に在籍していた店舗名があれば教えてください。' },
  { key: 'tattoo', text: 'タトゥーや鯖（スジ彫り）はありますか？', options: ['あり', 'なし'] },
  { key: 'photo', text: '顔写真または全身写真を送ってください。' },
];

app.post('/webhook', line.middleware(config), async (req, res) => {
  Promise.all(req.body.events.map(handleEvent)).then(() => res.status(200).end());
});

async function handleEvent(event) {
  if (event.type !== 'message') return;

  const userId = event.source.userId;
  const user = userStates[userId] || { step: 0, answers: {} };
  const currentQuestion = questions[user.step];

  if (!currentQuestion) return;

  if (currentQuestion.key === 'photo' && event.message.type === 'image') {
    const buffer = await downloadImage(event.message.id);
    const base64Image = buffer.toString('base64');
    user.answers.photo = base64Image;
    await postToGAS(user.answers, userId);
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ご回答ありがとうございました！内容を確認して担当者よりご連絡いたします。'
    });
    delete userStates[userId];
    return;
  }

  // 通常のテキスト・選択肢回答処理
  const message = event.message;
  if (message.type !== 'text') return;

  // 初期化トリガー
  if (!userStates[userId] || message.text === 'スタート') {
    userStates[userId] = { step: 0, answers: {} };
    await sendQuestion(userId, 0, event.replyToken);
    return;
  }

  // 回答保存
  user.answers[currentQuestion.key] = message.text;
  user.step += 1;
  userStates[userId] = user;

  const nextQuestion = questions[user.step];
  if (nextQuestion) {
    await sendQuestion(userId, user.step, event.replyToken);
  }
}

async function sendQuestion(userId, step, replyToken) {
  const question = questions[step];
  if (!question) return;

  if (question.options) {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: question.text,
      quickReply: {
        items: question.options.map(option => ({
          type: 'action',
          action: {
            type: 'message',
            label: option,
            text: option
          }
        }))
      }
    });
  } else {
    await client.replyMessage(replyToken, {
      type: 'text',
      text: question.text
    });
  }
}

async function downloadImage(messageId) {
  const stream = await client.getMessageContent(messageId);
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function postToGAS(answers, userId) {
  const response = await axios.post('【GAS_ENDPOINT】', {
    name: answers.name,
    base64Image: answers.photo,
    interview: answers.interview,
    experience: answers.experience,
    pastShop: answers.pastShop,
    tattoo: answers.tattoo,
    userId: userId,
    timestamp: new Date().toISOString()
  });
  console.log('GAS Response:', response.data);
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

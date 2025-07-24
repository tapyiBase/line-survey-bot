const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const axios = require('axios');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const GAS_URL = process.env.GAS_URL;
const client = new Client(config);
const app = express();
app.use(express.json());
app.use(middleware(config));

const questions = [
  {
    key: 'name',
    text: 'お名前（本名）を教えてください。'
  },
  {
    key: 'interview',
    text: '面接希望日を教えてください（例：7月25日 or 未定）'
  },
  {
    key: 'experience',
    text: 'キャバクラ勤務の経験はありますか？',
    quickReply: ['あり', 'なし']
  },
  {
    key: 'pastShops',
    text: '過去に在籍していた店舗があれば教えてください（なしでもOK）'
  },
  {
    key: 'tattoo',
    text: 'タトゥー・傷はありますか？',
    quickReply: ['あり', 'なし']
  }
];

const userStates = new Map();

app.post('/webhook', async (req, res) => {
  Promise.all(req.body.events.map(handleEvent)).then(() => res.sendStatus(200));
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const userInput = event.message.text.trim();

  if (!userStates.has(userId)) {
    userStates.set(userId, { answers: {}, currentIndex: 0 });
    return sendQuestion(replyToken, userId);
  }

  const state = userStates.get(userId);
  const question = questions[state.currentIndex];
  state.answers[question.key] = userInput;
  state.currentIndex++;

  if (state.currentIndex < questions.length) {
    return sendQuestion(replyToken, userId);
  } else {
    await saveToSpreadsheet(userId, state.answers);
    await client.replyMessage(replyToken, {
      type: 'text',
      text: 'アンケートのご回答ありがとうございました！'
    });
    userStates.delete(userId);
  }
}

async function sendQuestion(replyToken, userId) {
  const state = userStates.get(userId);
  const q = questions[state.currentIndex];

  const message = {
    type: 'text',
    text: q.text
  };

  if (q.quickReply) {
    message.quickReply = {
      items: q.quickReply.map(choice => ({
        type: 'action',
        action: {
          type: 'message',
          label: choice,
          text: choice
        }
      }))
    };
  }

  return client.replyMessage(replyToken, message);
}

async function saveToSpreadsheet(userId, answers) {
  const data = {
    userId,
    timestamp: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
    ...answers
  };

  try {
    await axios.post(GAS_URL, data);
  } catch (error) {
    console.error('スプレッドシートへの保存失敗:', error.message);
  }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on ${port}`);
});

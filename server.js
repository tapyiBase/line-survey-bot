// server.js

const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// --- 固定情報 ---
const LINE_CHANNEL_SECRET = '1564c7045280f8e5de962041ffb6568b';
const LINE_CHANNEL_ACCESS_TOKEN = 'vTdm94c2EPcZs3p7ktHfVvch8HHZ64/rD5SWKmm7jEfl+S0Lw12WvRUSTN1h3q6ymJUGlfMBmUEi8u+5IebXDe9UTQXvfM8ABDfEIShRSvghvsNEQD0Ms+vX3tOy9zo3EpJL8oE0ltSGHIZFskwNagdB04t89/1O/w1cDnyilFU=';
const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxDN14UbuIVIXZNj-RWGIE5G6lUqnG6I9AEmsEDNKttEsAGmkCVrd0CscBMdRqiP7AK0Q/exec';

const config = {
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: LINE_CHANNEL_SECRET
};

const client = new line.Client(config);

// --- 質問リスト ---
const questions = [
  { type: 'text', text: '本名を教えてください。' },
  { type: 'text', text: '面接希望日を教えてください。（例：7月25日 15:00〜）' },
  {
    type: 'quickReply', text: '経験はありますか？', options: [
      { label: 'あり', text: 'あり' },
      { label: 'なし', text: 'なし' }
    ]
  },
  { type: 'text', text: '過去に在籍していた店舗名があれば教えてください。' },
  {
    type: 'quickReply', text: 'タトゥーや鯖（スジ彫り）はありますか？', options: [
      { label: 'あり', text: 'あり' },
      { label: 'なし', text: 'なし' }
    ]
  },
  { type: 'image', text: '顔写真または全身写真を送ってください。' }
];

// --- メモリ上のユーザ状態 ---
const userStates = {};

app.post('/webhook', line.middleware(config), async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    if (event.type !== 'message') continue;
    const userId = event.source.userId;
    const message = event.message;

    if (!userStates[userId]) {
      userStates[userId] = { answers: [], step: 0 };
      await sendQuestion(userId);
      continue;
    }

    const state = userStates[userId];

    // 回答保存（画像の場合はURLに変換）
    if (message.type === 'image') {
      const stream = await client.getMessageContent(message.id);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      const base64 = buffer.toString('base64');
      const imageUrl = `data:image/jpeg;base64,${base64}`;
      state.answers.push(imageUrl);
    } else {
      state.answers.push(message.text);
    }

    state.step++;

    if (state.step < questions.length) {
      await sendQuestion(userId);
    } else {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'ご回答ありがとうございました！内容を送信しました。'
      });

      // GASに送信
      await axios.post(GAS_ENDPOINT, {
        userId,
        answers: state.answers
      });
      delete userStates[userId];
    }
  }
  res.sendStatus(200);
});

// --- 質問送信関数 ---
async function sendQuestion(userId) {
  const state = userStates[userId];
  const q = questions[state.step];

  if (q.type === 'quickReply') {
    await client.pushMessage(userId, {
      type: 'text',
      text: q.text,
      quickReply: {
        items: q.options.map(opt => ({
          type: 'action',
          action: {
            type: 'message',
            label: opt.label,
            text: opt.text
          }
        }))
      }
    });
  } else {
    await client.pushMessage(userId, {
      type: 'text',
      text: q.text
    });
  }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

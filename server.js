// server.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const app = express();

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GAS_ENDPOINT = process.env.GAS_ENDPOINT;

app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

const questions = [
  '本名（氏名）を教えてください。',
  '面接希望日を教えてください。（例：7月25日 15:00〜）',
  '経験はありますか？（あり / なし）',
  '過去に在籍していた店舗名があれば教えてください。',
  'タトゥーや鯖（スジ彫り）はありますか？（あり / なし）',
  '顔写真または全身写真を送ってください。',
  'ご回答ありがとうございました！内容を確認して担当者よりご連絡いたします。'
];

const userStates = {};

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
    return res.status(401).send('Unauthorized');
  }

  const events = req.body.events;
  for (const event of events) {
    const userId = event.source?.userId;
    const replyToken = event.replyToken;

    // 初回起動
    if (!userStates[userId]) {
      const text = event.message?.text?.toLowerCase();
      if (text?.includes('こんにちは') || text?.includes('スタート')) {
        userStates[userId] = { step: 0, answers: [] };
        await replyWithQuestion(replyToken, 0);
      }
      continue;
    }

    const state = userStates[userId];

    // 画像 or テキストの処理
    if (event.message?.type === 'text') {
      state.answers.push(event.message.text.trim());
    } else if (event.message?.type === 'image') {
      const imageUrl = `https://api-data.line.me/v2/bot/message/${event.message.id}/content`;
      state.answers.push(imageUrl);
    } else {
      await replyMessage(replyToken, { type: 'text', text: 'テキストか画像を送信してください。' });
      continue;
    }

    state.step++;

    if (state.step < questions.length - 1) {
      await replyWithQuestion(replyToken, state.step);
    } else {
      await replyMessage(replyToken, { type: 'text', text: questions[questions.length - 1] });

      try {
        await axios.post(GAS_ENDPOINT, {
          userId,
          answers: state.answers
        });
      } catch (err) {
        console.error('GAS POST Error:', err.response?.data || err.message);
      }

      delete userStates[userId];
    }
  }

  res.status(200).send('OK');
});

async function replyWithQuestion(token, index) {
  const question = questions[index];
  const message = {
    type: 'text',
    text: question
  };
  await replyMessage(token, message);
}

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
  } catch (err) {
    console.error('Reply Error:', err.response?.data || err.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

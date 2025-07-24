const express = require('express');
const { middleware, Client } = require('@line/bot-sdk');
const bodyParser = require('body-parser');
const axios = require('axios');

const LINE_CHANNEL_SECRET = '1564c7045280f8e5de962041ffb6568b';
const LINE_CHANNEL_ACCESS_TOKEN = 'vTdm94c2EPcZs3p7ktHfVvch8HHZ64/rD5SWKmm7jEfl+S0Lw12WvRUSTN1h3q6ymJUGlfMBmUEi8u+5IebXDe9UTQXvfM8ABDfEIShRSvghvsNEQD0Ms+vX3tOy9zo3EpJL8oE0ltSGHIZFskwNagdB04t89/1O/w1cDnyilFU=';
const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxDN14UbuIVIXZNj-RWGIE5G6lUqnG6I9AEmsEDNKttEsAGmkCVrd0CscBMdRqiP7AK0Q/exec';

const config = {
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: LINE_CHANNEL_SECRET,
};

const app = express();
const client = new Client(config);

app.use(bodyParser.json());
app.post('/webhook', middleware(config), async (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch(err => {
      console.error('Error in webhook handling:', err);
      res.status(500).end();
    });
});

const userStates = {};

const questions = [
  '1. 本名（氏名）を教えてください。',
  '2. 面接希望日を教えてください。（例：7月25日 15:00〜）',
  '3. 経験はありますか？（あり / なし）',
  '4. 過去に在籍していた店舗名があれば教えてください。',
  '5. タトゥーや鯖（スジ彫り）はありますか？（あり / なし）',
  '6. 顔写真または全身写真を送ってください。',
];

async function handleEvent(event) {
  if (event.type !== 'message') return;

  const userId = event.source.userId;
  if (!userStates[userId]) {
    userStates[userId] = { step: 0, answers: [] };
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: questions[0],
    });
  }

  const state = userStates[userId];

  // 画像を送った場合
  if (state.step === 5 && event.message.type === 'image') {
    const stream = await client.getMessageContent(event.message.id);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const base64Image = buffer.toString('base64');

    state.answers.push(`data:image/jpeg;base64,${base64Image}`);
    await sendToGAS(userId, state.answers);

    delete userStates[userId];
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ご回答ありがとうございました！内容を確認して担当者よりご連絡いたします。',
    });
  }

  // テキストでの回答
  if (event.message.type === 'text') {
    state.answers.push(event.message.text);
    state.step++;

    if (state.step < questions.length) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: questions[state.step],
      });
    }

    await sendToGAS(userId, state.answers);
    delete userStates[userId];
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ご回答ありがとうございました！内容を確認して担当者よりご連絡いたします。',
    });
  }
}

async function sendToGAS(userId, answers) {
  try {
    await axios.post(GAS_ENDPOINT, {
      userId,
      answers,
    });
  } catch (error) {
    console.error('Failed to send to GAS:', error);
  }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');
const crypto = require('crypto');
const { Buffer } = require('buffer');

const app = express();
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// 環境変数を利用（Render上で設定）
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.Client(config);

// 質問リスト（必要に応じて増やせます）
const questions = [
  { key: 'name', text: '本名（氏名）を教えてください。' },
  { key: 'date', text: '面接希望日を教えてください。（例：7月25日 15:00〜）' },
  { key: 'experience', text: '経験はありますか？', options: ['あり', 'なし'] },
  { key: 'previousShop', text: '過去に在籍していた店舗名があれば教えてください。' },
  { key: 'tattoo', text: 'タトゥーや鯖（スジ彫り）はありますか？', options: ['あり', 'なし'] },
  { key: 'image', text: '顔写真または全身写真を送ってください。' }
];

// ユーザー状態管理（in-memory）
const userStates = {};

app.post('/webhook', (req, res) => {
  const signature = req.headers['x-line-signature'];
  const isValid = validateSignature(req.rawBody, config.channelSecret, signature);
  if (!isValid) {
    return res.status(401).send('Unauthorized');
  }

  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch(err => {
      console.error('Event handling error:', err);
      res.status(500).end();
    });
});

function validateSignature(rawBody, channelSecret, signature) {
  const hmac = crypto.createHmac('sha256', channelSecret);
  hmac.update(Buffer.from(rawBody));
  const expectedSignature = hmac.digest('base64');
  return signature === expectedSignature;
}

async function handleEvent(event) {
  if (event.type !== 'message') return;

  const userId = event.source.userId;
  const message = event.message;

  if (!userStates[userId]) {
    userStates[userId] = { answers: {}, step: 0 };
    await sendQuestion(userId);
    return;
  }

  const state = userStates[userId];
  const currentQuestion = questions[state.step];

  if (message.type === 'text') {
    state.answers[currentQuestion.key] = message.text;
    state.step++;

    if (state.step < questions.length) {
      await sendQuestion(userId);
    } else {
      await sendText(userId, 'ご回答ありがとうございました！内容を確認して担当者よりご連絡いたします。');
      await sendToGAS(userId);
      delete userStates[userId];
    }

  } else if (message.type === 'image' && currentQuestion.key === 'image') {
    const imageBuffer = await getImageBuffer(message.id);
    const base64Image = imageBuffer.toString('base64');

    const imageRes = await axios.post(process.env.GAS_ENDPOINT, {
      base64Image,
      name: state.answers['name'] || '未登録ユーザー'
    });

    state.answers['imageUrl'] = imageRes.data.imageUrl;
    state.step++;

    await sendText(userId, '画像を受け取りました。');
    if (state.step < questions.length) {
      await sendQuestion(userId);
    } else {
      await sendText(userId, 'ご回答ありがとうございました！内容を確認して担当者よりご連絡いたします。');
      await sendToGAS(userId);
      delete userStates[userId];
    }
  }
}

async function sendQuestion(userId) {
  const state = userStates[userId];
  const q = questions[state.step];

  if (q.options) {
    const items = q.options.map(option => ({
      type: 'action',
      action: {
        type: 'message',
        label: option,
        text: option
      }
    }));

    await client.pushMessage(userId, {
      type: 'template',
      altText: q.text,
      template: {
        type: 'buttons',
        text: q.text,
        actions: q.options.map(option => ({
          type: 'message',
          label: option,
          text: option
        }))
      }
    });
  } else {
    await sendText(userId, q.text);
  }
}

async function sendText(userId, text) {
  await client.pushMessage(userId, {
    type: 'text',
    text
  });
}

async function getImageBuffer(messageId) {
  const stream = await client.getMessageContent(messageId);
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function sendToGAS(userId) {
  const data = userStates[userId].answers;
  data.userId = userId;

  try {
    await axios.post(process.env.GAS_ENDPOINT, data);
  } catch (err) {
    console.error('GAS送信エラー:', err);
  }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`LINE Bot server running on port ${port}`);
});

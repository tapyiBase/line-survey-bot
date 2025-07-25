const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf } }));

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.Client(config);

const GAS_ENDPOINT = process.env.GAS_ENDPOINT;

// 質問リスト（名前から開始）
const questions = [
  { type: 'text', text: '本名（氏名）を教えてください' },
  { type: 'dateOptions', text: '面接希望日を選んでください' },
  { type: 'timeOptions', text: 'ご希望の時間帯を選択してください' },
  { type: 'text', text: '経験はありますか？（あり / なし）' },
  { type: 'text', text: '過去に在籍していた店舗名があれば教えてください' },
  { type: 'text', text: 'タトゥーや鯖（スジ彫り）はありますか？（あり / なし）' },
  { type: 'image', text: '顔写真または全身写真を送信してください' }
];

const userStates = {};

function generateDateOptions() {
  const today = new Date();
  const options = [];
  for (let i = 0; i < 10; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const label = `${date.getMonth() + 1}/${date.getDate()}（${['日','月','火','水','木','金','土'][date.getDay()]}）`;
    options.push(label);
  }
  options.push('その他');
  return options;
}

function generateTimeOptions() {
  return ['15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', 'その他'];
}

app.post('/webhook', line.middleware(config), async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    if (event.type === 'message') {
      const userId = event.source.userId;
      const message = event.message;

      if (!userStates[userId]) {
        userStates[userId] = { answers: [], currentQuestion: 0 };
        await sendNextQuestion(userId);
      } else {
        const state = userStates[userId];
        const currentQ = questions[state.currentQuestion];

        if (message.type === 'image' && currentQ.type === 'image') {
          const imageBuffer = await downloadImage(message.id);
          const base64Image = imageBuffer.toString('base64');
          state.answers.push(`画像(base64): ${base64Image.substring(0, 100)}...`);
          state.currentQuestion++;
          await sendNextQuestion(userId);
        } else if (message.type === 'text') {
          state.answers.push(message.text);
          state.currentQuestion++;
          await sendNextQuestion(userId);
        } else {
          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: 'テキストまたは画像で回答してください'
          });
        }
      }
    }
  }
  res.sendStatus(200);
});

async function sendNextQuestion(userId) {
  const state = userStates[userId];
  if (state.currentQuestion >= questions.length) {
    // 送信完了、GASに送信
    await axios.post(GAS_ENDPOINT, {
      userId: userId,
      answers: state.answers
    });
    await client.pushMessage(userId, {
      type: 'text',
      text: 'ご回答ありがとうございました！内容を確認して担当者よりご連絡いたします。'
    });
    delete userStates[userId];
    return;
  }

  const question = questions[state.currentQuestion];

  if (question.type === 'dateOptions') {
    const options = generateDateOptions();
    await client.pushMessage(userId, {
      type: 'text',
      text: question.text,
      quickReply: {
        items: options.map(option => ({
          type: 'action',
          action: {
            type: 'message',
            label: option,
            text: option
          }
        }))
      }
    });
  } else if (question.type === 'timeOptions') {
    const options = generateTimeOptions();
    await client.pushMessage(userId, {
      type: 'text',
      text: question.text,
      quickReply: {
        items: options.map(option => ({
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
    await client.pushMessage(userId, {
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

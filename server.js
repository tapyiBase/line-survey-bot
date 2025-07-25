require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');
const crypto = require('crypto');
const rawBody = require('raw-body');
const app = express();
const PORT = process.env.PORT || 3000;

// LINE設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

// 質問定義
const questions = [
  { key: 'name', text: '本名（氏名）を教えてください。' },
  { key: '希望日', type: 'date' },
  { key: '希望時間', type: 'time' },
  {
    key: '経験',
    text: '経験はありますか？',
    quickReplies: ['あり', 'なし'],
  },
  { key: '過去在籍店舗', text: '過去に在籍していた店舗名があれば教えてください。' },
  {
    key: 'タトゥー',
    text: 'タトゥーや鯖（スジ彫り）はありますか？',
    quickReplies: ['あり', 'なし'],
  },
  {
    key: '画像URL',
    text: '顔写真または全身写真を送ってください📷',
  },
];

const client = new line.Client(config);
const userStates = {};

app.post('/webhook', async (req, res) => {
  try {
    const body = await rawBody(req);
    const signature = req.headers['x-line-signature'];
    const hash = crypto
      .createHmac('SHA256', config.channelSecret)
      .update(body)
      .digest('base64');

    if (signature !== hash) return res.status(403).send('Invalid signature');

    const events = JSON.parse(body).events;
    res.status(200).send('OK');
    events.forEach(async (event) => {
      if (event.type === 'message') {
        const userId = event.source.userId;
        if (!userStates[userId]) {
          userStates[userId] = { answers: {}, current: 0 };
          return sendQuestion(userId);
        }

        const state = userStates[userId];
        const question = questions[state.current];

        // 画像対応
        if (event.message.type === 'image' && question.key === '画像URL') {
          const imageBuffer = await client.getMessageContent(event.message.id);
          const buffer = await streamToBuffer(imageBuffer);
          const base64Image = buffer.toString('base64');
          const response = await axios.post(process.env.GAS_ENDPOINT, {
            userId,
            key: '画像URL',
            imageBase64: base64Image,
          });
          state.answers['画像URL'] = response.data.url;
          state.current++;
          return sendQuestion(userId);
        }

        // テキスト対応
        if (event.message.type === 'text') {
          const answer = event.message.text;
          const key = question.key;

          // 「それ以外」を選んだ場合、手入力を受けるモード
          if (key === '希望日' && answer === 'それ以外の日付を希望') {
            state.expectingCustomDate = true;
            return client.replyMessage(event.replyToken, {
              type: 'text',
              text: 'ご希望の日付を入力してください。（例：8月10日）',
            });
          }

          if (state.expectingCustomDate) {
            state.answers['希望日'] = answer;
            state.expectingCustomDate = false;
            state.current++;
            return sendQuestion(userId);
          }

          state.answers[key] = answer;
          state.current++;
          return sendQuestion(userId);
        }
      }
    });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error');
  }
});

function sendQuestion(userId) {
  const state = userStates[userId];
  const question = questions[state.current];

  if (!question) {
    // すべて完了
    axios.post(process.env.GAS_ENDPOINT, {
      userId,
      ...state.answers,
    });
    client.pushMessage(userId, {
      type: 'text',
      text: 'ご回答ありがとうございました！内容を確認して担当者よりご連絡いたします。',
    });
    delete userStates[userId];
    return;
  }

  // 希望日ステップ
  if (question.type === 'date') {
    const today = new Date();
    const choices = [...Array(10)].map((_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const label = `${d.getMonth() + 1}月${d.getDate()}日`;
      return {
        type: 'action',
        action: {
          type: 'message',
          label,
          text: label,
        },
      };
    });
    choices.push({
      type: 'action',
      action: {
        type: 'message',
        label: 'それ以外の日付を希望',
        text: 'それ以外の日付を希望',
      },
    });

    return client.pushMessage(userId, {
      type: 'text',
      text: '面接希望日を選択してください。',
      quickReply: { items: choices },
    });
  }

  // 時間選択
  if (question.type === 'time') {
    const times = [...Array(8)].map((_, i) => {
      const h = 15 + i;
      return {
        type: 'action',
        action: {
          type: 'message',
          label: `${h}:00`,
          text: `${h}:00`,
        },
      };
    });
    return client.pushMessage(userId, {
      type: 'text',
      text: '面接希望時間を選択してください。',
      quickReply: { items: times },
    });
  }

  // QuickReply
  if (question.quickReplies) {
    return client.pushMessage(userId, {
      type: 'text',
      text: question.text,
      quickReply: {
        items: question.quickReplies.map((label) => ({
          type: 'action',
          action: {
            type: 'message',
            label,
            text: label,
          },
        })),
      },
    });
  }

  // 通常テキスト質問
  return client.pushMessage(userId, {
    type: 'text',
    text: question.text,
  });
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

require('dotenv').config();
const express = require('express');
const { middleware, Client } = require('@line/bot-sdk');
const axios = require('axios');

const app = express();
app.use(express.json());

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};
const client = new Client(config);

// 質問内容（QuickReply含む）
const questions = [
  { text: 'お名前（漢字フルネーム）を教えてください。', type: 'text' },
  { text: '年齢を教えてください。', type: 'text' },
  {
    text: '希望の勤務形態を選んでください。',
    type: 'quickReply',
    options: ['正社員', 'アルバイト'],
  },
  {
    text: '週に何日働けますか？',
    type: 'quickReply',
    options: ['1〜2日', '3〜4日', '5〜6日', '毎日OK'],
  },
  {
    text: '顔写真または全身写真のURLを貼り付けてください（または画像を送ってください）。',
    type: 'text',
  },
];

const userStates = new Map();

app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;

  await Promise.all(events.map(async (event) => {
    if (event.type !== 'message') return;

    const userId = event.source.userId;
    const userState = userStates.get(userId) || { answers: [], step: 0 };
    const messageType = event.message.type;

    let answerText;

    if (messageType === 'text') {
      answerText = event.message.text;
    } else if (messageType === 'image') {
      // 画像メッセージを "[画像が送信されました]" として記録
      answerText = '[画像が送信されました]';
    } else {
      // テキスト・画像以外はスキップ
      return;
    }

    userState.answers.push(answerText);
    userState.step++;

    if (userState.step < questions.length) {
      const nextQuestion = questions[userState.step];
      if (nextQuestion.type === 'quickReply') {
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: nextQuestion.text,
          quickReply: {
            items: nextQuestion.options.map((opt) => ({
              type: 'action',
              action: {
                type: 'message',
                label: opt,
                text: opt,
              },
            })),
          },
        });
      } else {
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: nextQuestion.text,
        });
      }
    } else {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'ご回答ありがとうございました！内容を確認して担当者よりご連絡いたします。',
      });

      // GASに送信
      try {
        await axios.post(process.env.GAS_URL, {
          userId: userId,
          answers: userState.answers,
        });
      } catch (error) {
        console.error('GAS送信エラー:', error.message);
      }

      // 状態をリセット
      userStates.delete(userId);
    }

    userStates.set(userId, userState);
  }));

  res.sendStatus(200);
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

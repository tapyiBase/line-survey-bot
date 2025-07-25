require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');

const app = express();
app.use(express.json());

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);

// 質問と回答を管理するオブジェクト
const userStates = {};

const questions = [
  { key: 'name', text: '① 本名（氏名）を教えてください。' },
  { key: 'date', text: '② 面接希望日を教えてください。（例：7月25日 15:00〜）' },
  { key: 'experience', text: '③ 経験はありますか？', options: ['あり', 'なし'] },
  { key: 'previousShop', text: '④ 過去に在籍していた店舗名があれば教えてください。' },
  { key: 'tattoo', text: '⑤ タトゥーや鯖（スジ彫り）はありますか？', options: ['あり', 'なし'] },
  { key: 'imageUrl', text: '⑥ 顔写真または全身写真のURLを貼り付けてください。' }
];

// Webhookエンドポイント
app.post('/webhook', line.middleware(config), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === 'message') {
      await handleMessage(event);
    }
  }

  res.sendStatus(200);
});

async function handleMessage(event) {
  const userId = event.source.userId;
  const userState = userStates[userId] || { current: 0, answers: { userId } };

  const currentQuestion = questions[userState.current];

  // QuickReply 対応
  if (currentQuestion.options) {
    const selected = event.message.text;
    if (!currentQuestion.options.includes(selected)) {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: '選択肢からお選びください。',
        quickReply: {
          items: currentQuestion.options.map(option => ({
            type: 'action',
            action: {
              type: 'message',
              label: option,
              text: option
            }
          }))
        }
      });
      return;
    }
  }

  // 回答を保存
  userState.answers[currentQuestion.key] = event.message.text;
  userState.current++;

  // 次の質問 or 終了
  if (userState.current < questions.length) {
    const next = questions[userState.current];
    const message = {
      type: 'text',
      text: next.text
    };

    if (next.options) {
      message.quickReply = {
        items: next.options.map(option => ({
          type: 'action',
          action: {
            type: 'message',
            label: option,
            text: option
          }
        }))
      };
    }

    await client.replyMessage(event.replyToken, message);
  } else {
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '⑦ ご回答ありがとうございました！内容を確認して担当者よりご連絡いたします。'
    });

    // ✅ GASに送信
    console.log('送信データ:', userState.answers);
    try {
      await axios.post(process.env.GAS_ENDPOINT, userState.answers);
    } catch (error) {
      console.error('GAS送信エラー:', error.message);
    }

    // 初期化
    delete userStates[userId];
  }

  // 状態更新
  userStates[userId] = userState;
}

// ポート設定
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

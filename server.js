const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');
require('dotenv').config();

const app = express();

// LINE設定
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};
const client = new line.Client(config);

// ユーザーの状態を一時的に保持
const userStates = {};

// Webhookエンドポイント
app.post('/webhook', line.middleware(config), async (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch(err => {
      console.error(err);
      res.status(500).end();
    });
});

// イベントハンドラ
async function handleEvent(event) {
  if (event.type !== 'message') return;

  const userId = event.source.userId;
  const text = event.message.text;

  // 初期化
  if (!userStates[userId]) {
    userStates[userId] = { step: 1, answers: { userId } };
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'アンケートを始めます！\nお名前（漢字）を教えてください。',
    });
  }

  const s = userStates[userId];

  switch (s.step) {
    case 1:
      s.answers.name = text;
      s.step++;
      return quick(event, '希望の職種を選んでください', ['黒服', 'キャバ嬢', 'その他']);
    case 2:
      s.answers.jobType = text;
      s.step++;
      return quick(event, '希望エリアを選んでください', ['新宿', '渋谷', '六本木', 'その他']);
    case 3:
      s.answers.area = text;
      s.step++;
      return quick(event, '出勤可能な日数を教えてください', ['週1〜2日', '週3〜4日', 'フル出勤']);
    case 4:
      s.answers.days = text;
      s.step++;
      return quick(event, '経験はありますか？', ['未経験', '1年未満', '1年以上']);
    case 5:
      s.answers.experience = text;
      s.step++;
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '自己PRがあれば入力してください',
      });
    case 6:
      s.answers.pr = text;
      // Google Apps Scriptへ送信
      await axios.post(process.env.GAS_URL, s.answers);
      delete userStates[userId];
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'ご回答ありがとうございました！登録しました📩',
      });
  }
}

// クイックリプライ作成
function quick(event, question, choices) {
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: question,
    quickReply: {
      items: choices.map(label => ({
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

// ポート設定（Renderでは環境変数PORTを使用）
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on ${port}`));

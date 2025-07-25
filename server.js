const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const line = require('@line/bot-sdk');
const app = express();

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.Client(config);
app.use(express.raw({ type: '*/*' })); // ⭐️ LINEの署名検証に必要

// 質問セット（順番に聞く）
const questions = [
  { key: 'name', text: '① 本名（氏名）を教えてください。' },
  { key: 'date', text: '② 面接希望日を教えてください。（例：7月25日 15:00〜）' },
  {
    key: 'experience',
    text: '③ 経験はありますか？',
    quickReply: ['あり', 'なし']
  },
  { key: 'previousShop', text: '④ 過去に在籍していた店舗名があれば教えてください。' },
  {
    key: 'tattoo',
    text: '⑤ タトゥーや鯖（スジ彫り）はありますか？',
    quickReply: ['あり', 'なし']
  },
  { key: 'image', text: '⑥ 顔写真または全身写真を送ってください。（カメラマークで送信）' }
];

// 状態管理（userIdごとに質問ステータスを保持）
const userStates = {};

app.post('/webhook', async (req, res) => {
  if (!validateSignature(req)) {
    return res.status(401).send('Invalid signature');
  }

  const events = JSON.parse(req.body).events;

  for (const event of events) {
    if (event.type === 'message') {
      const userId = event.source.userId;

      if (!userStates[userId]) {
        userStates[userId] = { step: 0, answers: { userId } };
      }

      const state = userStates[userId];
      const current = questions[state.step];

      // メッセージが画像の場合（image）
      if (event.message.type === 'image' && current.key === 'image') {
        try {
          const buffer = await downloadImage(event.message.id);
          const base64Image = buffer.toString('base64');

          // GASに送信
          await axios.post(process.env.GAS_ENDPOINT, {
            base64Image,
            name: state.answers.name || '未登録ユーザー'
          });

          state.answers.imageUrl = '画像アップロード済';
          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: '⑦ ご回答ありがとうございました！内容を確認して担当者よりご連絡いたします。'
          });

          // 回答全体をGASへ送信
          await axios.post(process.env.GAS_ENDPOINT, state.answers);

          delete userStates[userId]; // 状態リセット
        } catch (err) {
          console.error('画像処理エラー:', err);
          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: '画像の保存中にエラーが発生しました。再度お試しください。'
          });
        }
      }

      // テキストメッセージの場合
      if (event.message.type === 'text' && current.key !== 'image') {
        state.answers[current.key] = event.message.text;
        state.step++;

        if (state.step < questions.length) {
          const next = questions[state.step];
          await client.replyMessage(event.replyToken, formatQuestion(next));
        } else {
          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: '画像を送ってください📷'
          });
        }
      }
    }
  }

  res.status(200).send('OK');
});

// 署名検証関数
function validateSignature(req) {
  const signature = req.headers['x-line-signature'];
  const body = req.body;
  const hash = crypto
    .createHmac('SHA256', config.channelSecret)
    .update(body)
    .digest('base64');
  return hash === signature;
}

// QuickReplyの整形
function formatQuestion(q) {
  if (q.quickReply) {
    return {
      type: 'text',
      text: q.text,
      quickReply: {
        items: q.quickReply.map(label => ({
          type: 'action',
          action: {
            type: 'message',
            label,
            text: label
          }
        }))
      }
    };
  } else {
    return { type: 'text', text: q.text };
  }
}

// 画像をLINEのContent APIから取得
async function downloadImage(messageId) {
  const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${config.channelAccessToken}`
    },
    responseType: 'arraybuffer'
  });
  return Buffer.from(response.data, 'binary');
}

// サーバー起動
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const axios = require('axios');
const bodyParser = require('body-parser');
const app = express();

// LINE設定（環境変数を利用）
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(config);

// 質問一覧
const questions = [
  { key: 'name', text: '本名（氏名）を教えてください。' },
  { key: 'interview', text: '面接希望日を教えてください。（例：7月25日 15:00〜）' },
  { key: 'experience', text: '経験はありますか？', options: ['あり', 'なし'] },
  { key: 'pastShop', text: '過去に在籍していた店舗名があれば教えてください。' },
  { key: 'tattoo', text: 'タトゥーや鯖（スジ彫り）はありますか？', options: ['あり', 'なし'] },
  { key: 'image', text: '顔写真または全身写真を送信してください。' }
];

// メモリ内保存（本番運用ではDB等に切り替え推奨）
const userStates = {};

app.use(bodyParser.json());

// ✅ LINE webhook用：middlewareはこのルートのみに適用
app.post('/webhook', middleware(config), async (req, res) => {
  Promise.all(req.body.events.map(handleEvent)).then(() => res.status(200).end());
});

// 📌 GAS転送エンドポイント（画像処理後POST）
app.post('/sendToGAS', async (req, res) => {
  try {
    const { base64Image, name, userId } = req.body;
    const response = await axios.post(process.env.GAS_ENDPOINT, {
      base64Image,
      name,
      userId
    });
    res.json({ status: 'success', url: response.data.imageUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 📌 LINEイベント処理本体
async function handleEvent(event) {
  const userId = event.source.userId;

  // 📷 画像を受け取った場合
  if (event.message?.type === 'image') {
    const stream = await client.getMessageContent(event.message.id);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const base64Image = buffer.toString('base64');

    const name = userStates[userId]?.answers?.name || '未登録ユーザー';

    await axios.post(process.env.SERVER_BASE_URL + '/sendToGAS', {
      base64Image,
      name,
      userId
    });

    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '画像を受け取りました。ご回答ありがとうございました！担当者よりご連絡いたします。'
    });

    userStates[userId] = null;
    return;
  }

  // テキスト処理
  if (event.type === 'message' && event.message.type === 'text') {
    const msg = event.message.text;

    if (msg === 'スタート' || msg === 'こんにちは') {
      userStates[userId] = { step: 0, answers: {} };
      const q = questions[0];
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: q.text,
        ...(q.options && {
          quickReply: {
            items: q.options.map(opt => ({
              type: 'action',
              action: { type: 'message', label: opt, text: opt }
            }))
          }
        })
      });
      return;
    }

    const state = userStates[userId];
    if (!state) return;

    const currentStep = state.step;
    const currentQuestion = questions[currentStep];

    if (currentQuestion) {
      state.answers[currentQuestion.key] = msg;
      state.step += 1;
    }

    const nextQuestion = questions[state.step];

    if (nextQuestion) {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: nextQuestion.text,
        ...(nextQuestion.options && {
          quickReply: {
            items: nextQuestion.options.map(opt => ({
              type: 'action',
              action: { type: 'message', label: opt, text: opt }
            }))
          }
        })
      });
    } else {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: '最後に、顔写真または全身写真を送ってください。'
      });
    }
  }
}

// サーバー起動
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

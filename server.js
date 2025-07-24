const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const bodyParser = require('body-parser');
const line = require('@line/bot-sdk');

const app = express();

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};
const GAS_ENDPOINT = process.env.GAS_URL;
const client = new line.Client(config);

// rawBody取得
app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// 署名検証
function validateSignature(signature, body) {
  const hash = crypto
    .createHmac('SHA256', config.channelSecret)
    .update(body)
    .digest('base64');
  return signature === hash;
}

// 質問リスト
const questions = [
  { key: 'name', text: 'お名前を教えてください。', type: 'text' },
  { key: 'jobType', text: '希望職種を教えてください。', type: 'text' },
  { key: 'area', text: '希望勤務地を教えてください。', type: 'text' },
  { key: 'days', text: '出勤可能日数を教えてください（例：週3日）。', type: 'text' },
  { key: 'experience', text: '経験年数を教えてください（例：未経験、1年など）。', type: 'text' },
  { key: 'pr', text: '自己PRをお願いします。', type: 'text' },
  { key: 'photo_url', text: '顔写真を1枚送ってください。', type: 'image' },
];

// 状態管理（メモリ上）
const userContexts = {};

// メインWebhook
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  if (!validateSignature(signature, req.rawBody)) {
    return res.status(401).send('Unauthorized');
  }

  const events = req.body.events;
  for (const event of events) {
    if (event.type === 'message' || event.type === 'postback') {
      await handleEvent(event);
    }
  }

  res.status(200).send('OK');
});

// イベント処理
async function handleEvent(event) {
  const userId = event.source.userId;
  const msg = event.message;
  const context = userContexts[userId] || { answers: {}, stepIndex: -1 };

  // アンケート開始トリガー
  if (msg.type === 'text' && msg.text === '登録') {
    // すでに進行中か確認
    if (context.stepIndex >= 0 && context.stepIndex < questions.length) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'アンケートはすでに進行中です。前の質問に回答してください。',
      });
    }

    context.stepIndex = 0;
    userContexts[userId] = context;

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'アンケートを開始します。\n' + questions[0].text,
    });
  }

  // 進行中のユーザー
  if (context.stepIndex >= 0 && context.stepIndex < questions.length) {
    const currentQuestion = questions[context.stepIndex];

    if (currentQuestion.type === 'text' && msg.type === 'text') {
      context.answers[currentQuestion.key] = msg.text;
      context.stepIndex += 1;
    } else if (currentQuestion.type === 'image' && msg.type === 'image') {
      // 画像受信 → content取得 → base64変換
      try {
        const stream = await client.getMessageContent(msg.id);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        const base64Image = buffer.toString('base64');

        context.answers[currentQuestion.key] = base64Image;
        context.stepIndex += 1;
      } catch (error) {
        console.error('画像取得失敗:', error);
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '画像の受信に失敗しました。もう一度送ってください。',
        });
      }
    } else {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `「${currentQuestion.text}」への正しい形式での回答をお願いします。`,
      });
    }

    // 次の質問へ
    if (context.stepIndex < questions.length) {
      userContexts[userId] = context;
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: questions[context.stepIndex].text,
      });
    }

    // 最終送信（アンケート完了）
    const finalData = {
      userId,
      ...context.answers,
    };

    try {
      await axios.post(GAS_ENDPOINT, finalData);
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'ご登録ありがとうございました！内容を送信しました。',
      });
    } catch (error) {
      console.error('GAS送信失敗:', error);
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: '送信時にエラーが発生しました。しばらくして再度お試しください。',
      });
    }

    delete userContexts[userId];
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

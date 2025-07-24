const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GAS_ENDPOINT = process.env.GAS_ENDPOINT;

const questions = [
  '本名（氏名）を教えてください。',
  '面接希望日を教えてください。（例：7月25日 15:00〜）',
  '経験はありますか？（あり / なし）',
  '過去に在籍していた店舗名があれば教えてください。',
  'タトゥーや鯖（スジ彫り）はありますか？（あり / なし）',
  '顔写真または全身写真を送ってください。',
  'ご回答ありがとうございました！内容を確認して担当者よりご連絡いたします。'
];

const userStates = {};

app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

function validateSignature(signature, body) {
  const hash = crypto.createHmac('SHA256', LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return signature === hash;
}

app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  const body = req.rawBody;

  if (!validateSignature(signature, body)) {
    console.log('[署名エラー] Invalid signature');
    return res.status(401).send('Unauthorized');
  }

  const events = req.body.events;
  for (const event of events) {
    const userId = event.source.userId;
    const replyToken = event.replyToken;

    // 初期化：スタート
    if (!userStates[userId]) {
      const message = event.message?.text || '';
      if (message.includes('こんにちは') || message.includes('スタート')) {
        userStates[userId] = { step: 0, answers: [] };
        await replyMessage(replyToken, { type: 'text', text: questions[0] });
      }
      continue;
    }

    const state = userStates[userId];

    // 回答：テキスト or 画像
    if (event.message.type === 'text') {
      state.answers.push(event.message.text.trim());
      state.step++;
    } else if (event.message.type === 'image') {
      // 画像処理
      try {
        const imageId = event.message.id;
        const imageRes = await axios.get(`https://api-data.line.me/v2/bot/message/${imageId}/content`, {
          responseType: 'arraybuffer',
          headers: { 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` }
        });
        const base64Image = Buffer.from(imageRes.data).toString('base64');
        const dataUrl = `data:image/jpeg;base64,${base64Image}`;
        state.answers.push(dataUrl);
        state.step++;
      } catch (err) {
        console.error('[画像取得エラー]', err.message);
        await replyMessage(replyToken, { type: 'text', text: '画像の取得に失敗しました。もう一度お試しください。' });
        continue;
      }
    } else {
      await replyMessage(replyToken, { type: 'text', text: 'テキストか画像を送ってください。' });
      continue;
    }

    // 次の質問 or 完了処理
    if (state.step < questions.length - 1) {
      await replyMessage(replyToken, { type: 'text', text: questions[state.step] });
    } else {
      await replyMessage(replyToken, { type: 'text', text: questions[questions.length - 1] });

      // GAS送信
      try {
        await axios.post(GAS_ENDPOINT, {
          userId: userId,
          answers: state.answers
        });
        console.log(`[送信成功] userId: ${userId}`);
      } catch (error) {
        console.error('[GAS送信エラー]:', error.message);
      }

      delete userStates[userId];
    }
  }

  res.status(200).send('OK');
});

async function replyMessage(token, message) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', {
      replyToken: token,
      messages: [message]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });
  } catch (error) {
    console.error('[LINE送信エラー]', error.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

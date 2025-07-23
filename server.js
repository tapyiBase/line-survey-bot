const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const port = process.env.PORT || 10000;

const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;
const GAS_URL = process.env.GAS_URL;

app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// ユーザーの回答ステート管理用
const userStates = {};
const questions = [
  { key: 'name', text: '本名（氏名）を教えてください' },
  { key: 'interview_date', text: '面接希望日を教えてください' },
  { key: 'experience', text: '経験はありますか？', quickReply: ['あり', 'なし'] },
  { key: 'past_shop', text: '過去に在籍していた店舗があれば教えてください' },
  { key: 'tattoo', text: 'タトゥーや傷はありますか？', quickReply: ['あり', 'なし'] },
  { key: 'photo_url', text: '顔写真をアップロードしてください（画像URLでもOKです）' }
];

// LINEからの署名を検証
function validateSignature(req) {
  const signature = req.headers['x-line-signature'];
  const body = req.rawBody;
  const hash = crypto
    .createHmac('SHA256', CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return signature === hash;
}

app.post('/webhook', async (req, res) => {
  if (!validateSignature(req)) {
    return res.status(401).send('Unauthorized');
  }

  const events = req.body.events;
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userId = event.source.userId;
      const text = event.message.text.trim();

      if (text === '登録') {
        userStates[userId] = { answers: {}, current: 0 };
        await replyText(event.replyToken, 'アンケートを開始します。');
        await askNextQuestion(userId, event.replyToken);
      } else if (userStates[userId]) {
        const state = userStates[userId];
        const question = questions[state.current];
        state.answers[question.key] = text;
        state.current++;

        if (state.current < questions.length) {
          await askNextQuestion(userId, event.replyToken);
        } else {
          await replyText(event.replyToken, 'アンケートの回答ありがとうございました！');
          await sendToGAS(userId, state.answers);
          delete userStates[userId];
        }
      } else {
        await replyText(event.replyToken, '「登録」と送るとアンケートを始められます。');
      }
    }
  }

  res.sendStatus(200);
});

// 質問を送信する関数（QuickReply対応）
async function askNextQuestion(userId, replyToken) {
  const state = userStates[userId];
  const question = questions[state.current];

  const message = {
    type: 'text',
    text: question.text
  };

  if (question.quickReply) {
    message.quickReply = {
      items: question.quickReply.map(label => ({
        type: 'action',
        action: {
          type: 'message',
          label,
          text: label
        }
      }))
    };
  }

  await replyMessage(replyToken, [message]);
}

// LINEにメッセージを送信
async function replyText(replyToken, text) {
  await replyMessage(replyToken, [{ type: 'text', text }]);
}

async function replyMessage(replyToken, messages) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', {
      replyToken,
      messages
    }, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`
      }
    });
  } catch (error) {
    console.error('LINEメッセージ送信エラー:', error.response?.data || error.message);
  }
}

// GASにデータを送信
async function sendToGAS(userId, answers) {
  const payload = {
    timestamp: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
    userId,
    ...answers
  };

  try {
    await axios.post(GAS_URL, payload);
    console.log('✅ GAS送信成功:', payload);
  } catch (error) {
    console.error('❌ GAS送信エラー:', error.response?.data || error.message);
  }
}

app.get('/', (req, res) => {
  res.send('LINEアンケートBot稼働中');
});

app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});

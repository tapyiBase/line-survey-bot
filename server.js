const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const bodyParser = require('body-parser');
const app = express();

// 環境変数から読み込み
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const GAS_URL = process.env.GAS_URL;

// 質問リスト（順番厳守）
const questions = [
  { key: 'name', text: 'お名前（漢字）を教えてください。' },
  { key: 'age', text: '年齢を教えてください。' },
  { key: 'jobTypeConfirm', text: '職種は黒服でよろしいですか？', type: 'confirm' }, // 分岐
  { key: 'jobTypeOther', text: '希望職種を入力してください。', condition: (data) => data.jobTypeConfirm === 'いいえ' },
  { key: 'employmentType', text: '希望する雇用形態は？', type: 'quick', options: ['正社員', 'アルバイト'] },
  { key: 'area', text: '希望する勤務エリアは？（例：渋谷、新宿など）' },
  { key: 'days', text: '週に何日働けますか？' },
  { key: 'experience', text: '経験年数を教えてください。（未経験の場合は未経験と入力してください）' },
  { key: 'pr', text: '自己PR・意気込みがあればご記入ください。' }
];

// JSON解析 & raw body取得
app.use(bodyParser.json({
  verify: (req, res, buf) => { req.rawBody = buf }
}));

// 署名検証
function validateSignature(signature, body) {
  const hash = crypto.createHmac('SHA256', CHANNEL_SECRET).update(body).digest('base64');
  return signature === hash;
}

// LINEメッセージ送信関数
async function replyMessage(token, messages) {
  await axios.post('https://api.line.me/v2/bot/message/reply', {
    replyToken: token,
    messages: Array.isArray(messages) ? messages : [messages],
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`
    }
  });
}

// GAS送信関数
async function saveToGAS(data) {
  await axios.post(GAS_URL, data);
}

// 状態管理（簡易メモリ）
const userStates = {};

// Webhookエンドポイント
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  if (!validateSignature(signature, req.rawBody)) return res.status(401).send('Unauthorized');

  const events = req.body.events;
  for (const event of events) {
    if (event.type !== 'message' && event.type !== 'follow') continue;

    const userId = event.source.userId;
    const message = event.message?.text || '';
    const replyToken = event.replyToken;

    // 初回メッセージ（または「登録」「変更」）
    if (event.type === 'follow' || message === '登録' || message === '変更' || message === '修正') {
      userStates[userId] = { answers: {}, step: 0 };
      await replyMessage(replyToken, { type: 'text', text: 'アンケートを開始します。' });
      const q = questions[0];
      await replyMessage(replyToken, { type: 'text', text: q.text });
      return;
    }

    // 回答処理
    const state = userStates[userId];
    if (!state) {
      await replyMessage(replyToken, { type: 'text', text: '「登録」と送るとアンケートを始められます。' });
      return;
    }

    const currentQuestion = questions[state.step];
    if (currentQuestion.condition && !currentQuestion.condition(state.answers)) {
      state.step++;
    }

    // 回答保存
    if (currentQuestion.key === 'jobTypeConfirm' && ['はい', 'いいえ'].includes(message)) {
      state.answers[currentQuestion.key] = message;
    } else {
      state.answers[currentQuestion.key] = message;
    }
    state.step++;

    // 次の質問に進む
    while (state.step < questions.length) {
      const nextQ = questions[state.step];
      if (nextQ.condition && !nextQ.condition(state.answers)) {
        state.step++;
        continue;
      }

      if (nextQ.type === 'quick') {
        await replyMessage(replyToken, {
          type: 'text',
          text: nextQ.text,
          quickReply: {
            items: nextQ.options.map(opt => ({
              type: 'action',
              action: { type: 'message', label: opt, text: opt }
            }))
          }
        });
      } else if (nextQ.type === 'confirm') {
        await replyMessage(replyToken, {
          type: 'text',
          text: nextQ.text,
          quickReply: {
            items: ['はい', 'いいえ'].map(opt => ({
              type: 'action',
              action: { type: 'message', label: opt, text: opt }
            }))
          }
        });
      } else {
        await replyMessage(replyToken, { type: 'text', text: nextQ.text });
      }
      return;
    }

    // 最終確認
    const summary = Object.entries(state.answers).map(([k, v]) => `【${k}】${v}`).join('\n');
    await replyMessage(replyToken, [
      { type: 'text', text: '以下の内容で登録します。よろしいですか？\n\n' + summary },
      {
        type: 'text',
        text: '送信してよろしいですか？',
        quickReply: {
          items: [
            {
              type: 'action',
              action: { type: 'message', label: '送信', text: '送信' }
            },
            {
              type: 'action',
              action: { type: 'message', label: '修正', text: '修正' }
            }
          ]
        }
      }
    ]);
  }

  res.sendStatus(200);
});

// 送信 or 修正処理（追加のWebhookイベント処理）
app.post('/webhook', async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    if (event.type !== 'message') continue;
    const userId = event.source.userId;
    const replyToken = event.replyToken;
    const message = event.message.text;

    const state = userStates[userId];
    if (!state) continue;

    if (message === '送信') {
      await saveToGAS({ userId, ...state.answers });
      delete userStates[userId];
      await replyMessage(replyToken, { type: 'text', text: '送信が完了しました。ありがとうございました！' });
    } else if (message === '修正') {
      state.step = 0;
      await replyMessage(replyToken, { type: 'text', text: '修正を開始します。' });
      const q = questions[0];
      await replyMessage(replyToken, { type: 'text', text: q.text });
    }
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

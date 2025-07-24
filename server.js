const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const bodyParser = require('body-parser');
const app = express();

// シークレット情報
const LINE_CHANNEL_SECRET = '1564c7045280f8e5de962041ffb6568b';
const LINE_CHANNEL_ACCESS_TOKEN = 'vTdm94c2EPcZs3p7ktHfVvch8HHZ64/rD5SWKmm7jEfl+S0Lw12WvRUSTN1h3q6ymJUGlfMBmUEi8u+5IebXDe9UTQXvfM8ABDfEIShRSvghvsNEQD0Ms+vX3tOy9zo3EpJL8oE0ltSGHIZFskwNagdB04t89/1O/w1cDnyilFU=';
const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxDN14UbuIVIXZNj-RWGIE5G6lUqnG6I9AEmsEDNKttEsAGmkCVrd0CscBMdRqiP7AK0Q/exec';

// JSON整形用
app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// セッション状態保存用
const userStates = new Map();

// 質問リスト
const questions = [
  'まずはお名前を教えてください。',
  '年齢を教えてください。',
  '性別を教えてください。（男性 / 女性 / その他）',
  '希望する職種を教えてください。',
  '希望する雇用形態を教えてください。（正社員 / アルバイト）',
  '希望する勤務地エリアを教えてください。',
  '出勤可能な曜日を教えてください。',
  'これまでの経験年数を教えてください。',
  '自己PRを自由に記入してください。',
  'ご回答ありがとうございました！内容を確認して担当者よりご連絡いたします。'
];

// 署名確認
function validateSignature(signature, body) {
  const hash = crypto
    .createHmac('SHA256', LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return signature === hash;
}

// Webhookエンドポイント
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  const body = req.rawBody;

  if (!validateSignature(signature, body)) {
    console.log('[署名エラー] Invalid signature');
    return res.status(401).send('Unauthorized');
  }

  const events = req.body.events;

  for (const event of events) {
    if (event.type !== 'message' || event.message.type !== 'text') continue;

    const userId = event.source.userId;
    const userMessage = event.message.text;
    const replyToken = event.replyToken;

    // 状態取得（なければ初期化）
    let state = userStates.get(userId) || { step: 0, answers: [] };

    // スタートキーワード
    if (userMessage.includes('こんにちは') || userMessage.includes('スタート')) {
      state = { step: 0, answers: [] };
      userStates.set(userId, state);
      await replyMessage(replyToken, questions[0]);
      continue;
    }

    // アンケート回答保存
    if (state.step < questions.length - 1) {
      state.answers.push(userMessage);
      state.step += 1;
      userStates.set(userId, state);

      // 最終質問前なら次の質問へ
      if (state.step < questions.length - 1) {
        await replyMessage(replyToken, questions[state.step]);
      } else {
        await replyMessage(replyToken, questions[state.step]);

        // GASへ送信（名前、年齢、性別などの順で送る）
        try {
          await axios.post(GAS_ENDPOINT, {
            userId,
            answers: state.answers
          });
        } catch (err) {
          console.error('[GASエラー]', err.response?.data || err.message);
        }

        // 状態クリア
        userStates.delete(userId);
      }
    } else {
      // 完了後のメッセージ
      await replyMessage(replyToken, 'アンケートはすでに完了しています。もう一度始めるには「スタート」と送ってください。');
    }
  }

  res.status(200).send('OK');
});

// LINE返信関数
async function replyMessage(token, messageText) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', {
      replyToken: token,
      messages: [{ type: 'text', text: messageText }]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });
  } catch (err) {
    console.error('[返信エラー]', err.response?.data || err.message);
  }
}

// 起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

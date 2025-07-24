const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const bodyParser = require('body-parser');
const app = express();

// .envの環境変数を使用
const LINE_CHANNEL_SECRET = process.env.CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const GAS_ENDPOINT = process.env.GAS_URL;

// 質問一覧（QuickReplyの有無を含む）
const questions = [
  { text: '本名（氏名）を教えてください。' },
  { text: '面接希望日を教えてください。（例：7月25日 15:00〜）' },
  { 
    text: '経験はありますか？',
    quickReplies: ['あり', 'なし']
  },
  { text: '過去に在籍していた店舗名があれば教えてください。' },
  {
    text: 'タトゥーや鯖（スジ彫り）はありますか？',
    quickReplies: ['あり', 'なし']
  },
  { text: '顔写真または全身写真のURLを貼り付けてください。' },
  { text: 'ご回答ありがとうございました！内容を確認して担当者よりご連絡いたします。' }
];

const userStates = {};

app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

function validateSignature(signature, body) {
  const hash = crypto
    .createHmac('SHA256', LINE_CHANNEL_SECRET)
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
    if (event.type === 'message' && event.message.type === 'text') {
      const userId = event.source.userId;
      const replyToken = event.replyToken;
      const userMessage = event.message.text.trim();

      // 初期起動
      if (!userStates[userId]) {
        if (userMessage.includes('こんにちは') || userMessage.includes('スタート')) {
          userStates[userId] = { step: 0, answers: [] };
          await sendQuestion(replyToken, 0);
        }
        continue;
      }

      const state = userStates[userId];
      state.answers.push(userMessage);
      state.step++;

      if (state.step < questions.length - 1) {
        await sendQuestion(replyToken, state.step);
      } else {
        // 最後のメッセージ
        await replyMessage(replyToken, { type: 'text', text: questions[questions.length - 1].text });

        // GASに送信
        try {
          await axios.post(GAS_ENDPOINT, {
            userId,
            answers: state.answers
          });
          console.log(`[送信成功] userId: ${userId}`);
        } catch (error) {
          console.error('[送信エラー] GASへのPOST失敗:', error.response?.data || error.message);
        }

        delete userStates[userId];
      }
    }
  }

  res.status(200).send('OK');
});

async function sendQuestion(token, step) {
  const question = questions[step];
  const message = {
    type: 'text',
    text: question.text
  };

  // QuickReplyがある場合は付加
  if (question.quickReplies) {
    message.quickReply = {
      items: question.quickReplies.map(label => ({
        type: 'action',
        action: {
          type: 'message',
          label,
          text: label
        }
      }))
    };
  }

  await replyMessage(token, message);
}

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
    console.error('[LINE返信失敗]:', error.response?.data || error.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

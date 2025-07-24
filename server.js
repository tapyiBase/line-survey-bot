const express = require('express');
const { Client, validateSignature } = require('@line/bot-sdk');
const axios = require('axios');
const getRawBody = require('raw-body');
require('dotenv').config();

const app = express();

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new Client(config);

// 質問のリスト（アンケート）
const questions = [
  { type: 'text', text: '本名（氏名）を教えてください。' },
  { type: 'text', text: '面接希望日を教えてください。（例：7月25日 15:00〜）' },
  { type: 'quick', text: '経験はありますか？', options: ['あり', 'なし'] },
  { type: 'text', text: '過去に在籍していた店舗名があれば教えてください。' },
  { type: 'quick', text: 'タトゥーや鯖（スジ彫り）はありますか？', options: ['あり', 'なし'] },
  { type: 'text', text: '顔写真または全身写真のURLを貼り付けてください。' }
];

// メモリ上でユーザーごとの回答保存（Render再起動で消える）
const userState = {};

app.post('/webhook', async (req, res) => {
  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers['x-line-signature'];

    if (!validateSignature(rawBody, config.channelSecret, signature)) {
      return res.status(403).send('Invalid signature');
    }

    const body = JSON.parse(rawBody.toString());

    const events = body.events;
    for (const event of events) {
      if (event.type === 'message') {
        const userId = event.source.userId;
        if (!userState[userId]) {
          userState[userId] = { answers: [], current: 0 };
        }

        const user = userState[userId];
        const answer = event.message.type === 'text' ? event.message.text : '[非テキスト回答]';
        user.answers[user.current] = answer;
        user.current++;

        // すべての質問が完了した場合
        if (user.current >= questions.length) {
          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: 'ご回答ありがとうございました！内容を確認して担当者よりご連絡いたします。'
          });

          // Google Apps Script に送信
          await axios.post(process.env.GAS_ENDPOINT, {
            userId: userId,
            answers: user.answers
          });

          delete userState[userId];
        } else {
          // 次の質問を送信
          const nextQ = questions[user.current];
          if (nextQ.type === 'quick') {
            await client.replyMessage(event.replyToken, {
              type: 'text',
              text: nextQ.text,
              quickReply: {
                items: nextQ.options.map(opt => ({
                  type: 'action',
                  action: {
                    type: 'message',
                    label: opt,
                    text: opt
                  }
                }))
              }
            });
          } else {
            await client.replyMessage(event.replyToken, {
              type: 'text',
              text: nextQ.text
            });
          }
        }
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).send('Internal Server Error');
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 LINE Bot running on port ${PORT}`);
});

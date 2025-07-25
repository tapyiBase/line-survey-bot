require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');
const app = express();
const rawBody = require('raw-body');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.Client(config);

// 状態管理用
const userStates = {};
const userAnswers = {};

const questions = [
  { key: 'name', text: 'まずはあなたのお名前を教えてください。' },
  { key: 'date', text: '面接希望日を選んでください。', type: 'date' },
  { key: 'time', text: '希望時間帯を選んでください。', type: 'time' },
  { key: 'experience', text: '経験はありますか？', options: ['あり', 'なし'] },
  { key: 'previousShop', text: '過去に在籍していた店舗名があれば教えてください。' },
  { key: 'tattoo', text: 'タトゥーやスジ彫りはありますか？', options: ['あり', 'なし'] },
  { key: 'image', text: '顔写真または全身写真を送ってください。' }
];

app.post('/webhook', async (req, res) => {
  const body = await rawBody(req);
  const signature = req.headers['x-line-signature'];

  if (!line.validateSignature(body, config.channelSecret, signature)) {
    return res.status(401).send('Invalid signature');
  }

  const events = JSON.parse(body).events;
  await Promise.all(events.map(handleEvent));
  res.status(200).send('OK');
});

async function handleEvent(event) {
  if (event.type !== 'message') return;

  const userId = event.source.userId;
  if (!userStates[userId]) {
    userStates[userId] = 0;
    userAnswers[userId] = {};
  }

  const currentIndex = userStates[userId];
  const currentQuestion = questions[currentIndex];

  if (event.message.type === 'text') {
    const text = event.message.text;

    // 質問内容ごとの処理
    if (currentQuestion.key === 'date') {
      if (text === 'それ以外の日程を希望') {
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: 'ご希望の日程を手入力で教えてください（例：7月30日）'
        });
        return;
      }
    }

    if (currentQuestion.key === 'image') {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: '写真を送ってください📷'
      });
      return;
    }

    userAnswers[userId][currentQuestion.key] = text;
    userStates[userId]++;

  } else if (event.message.type === 'image' && currentQuestion.key === 'image') {
    const imageBase64 = await getImageBase64(event.message.id);
    userAnswers[userId]['base64Image'] = imageBase64;

    await sendToGAS(userId);
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ご回答ありがとうございました！内容を確認して担当者よりご連絡いたします。'
    });

    // リセット
    delete userStates[userId];
    delete userAnswers[userId];
    return;
  }

  // 次の質問
  const nextIndex = userStates[userId];
  if (nextIndex < questions.length) {
    const nextQuestion = questions[nextIndex];

    if (nextQuestion.type === 'date') {
      const today = new Date();
      const options = [];
      for (let i = 0; i < 10; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        const formatted = `${date.getMonth() + 1}月${date.getDate()}日`;
        options.push({ label: formatted, text: formatted });
      }
      options.push({ label: 'それ以外の日程を希望', text: 'それ以外の日程を希望' });

      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: nextQuestion.text,
        quickReply: {
          items: options.map(opt => ({
            type: 'action',
            action: {
              type: 'message',
              label: opt.label,
              text: opt.text
            }
          }))
        }
      });
    } else if (nextQuestion.type === 'time') {
      const timeOptions = [];
      for (let h = 15; h <= 22; h++) {
        timeOptions.push({ label: `${h}:00`, text: `${h}:00` });
      }

      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: nextQuestion.text,
        quickReply: {
          items: timeOptions.map(opt => ({
            type: 'action',
            action: {
              type: 'message',
              label: opt.label,
              text: opt.text
            }
          }))
        }
      });
    } else if (nextQuestion.options)

const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};
const client = new line.Client(config);

const userStates = {};

app.post('/webhook', line.middleware(config), async (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch(err => {
      console.error(err);
      res.status(500).end();
    });
});

async function handleEvent(event) {
  if (event.type !== 'message' || !event.message) return;

  const userId = event.source.userId;
  const text = event.message.text;

  if (!userStates[userId]) {
    userStates[userId] = { step: 1, answers: { userId } };
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'アンケートを始めます！\nあなたの本名を教えてください（漢字）',
    });
  }

  const s = userStates[userId];

  switch (s.step) {
    case 1:
      s.answers.realName = text;
      s.step++;
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '面接希望日を入力してください（日祝を除く19〜21時対応）',
      });

    case 2:
      s.answers.interviewDate = text;
      s.step++;
      return quick(event, 'キャバクラ経験はありますか？', ['あり', 'なし']);

    case 3:
      s.answers.hasExperience = text;
      if (text === 'あり') {
        s.step++;
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '過去に在籍していた店舗名を教えてください',
        });
      } else {
        s.answers.pastShops = '';
        s.step = 5;
        return quick(event, 'タトゥー・傷はありますか？', ['あり', 'なし']);
      }

    case 4:
      s.answers.pastShops = text;
      s.step++;
      return quick(event, 'タトゥー・傷はありますか？', ['あり', 'なし']);

    case 5:
      s.answers.hasTattooOrScar = text;
      s.step++;
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '顔がわかる写真を2〜3枚アップロードしてください（画像を送ってください）',
      });

    case 6:
      // 写真受信処理（画像でない場合は再入力促す）
      if (event.message.type !== 'image') {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '写真を画像形式で送信してください📷',
        });
      }

      // LINE画像URL取得（有効期限あり）
      const messageId = event.message.id;
      const imageUrl = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
      s.answers.photos = imageUrl;

      // スプレッドシートへ送信
      await axios.post(process.env.GAS_URL, s.answers);
      delete userStates[userId];

      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: 'ご応募ありがとうございました！担当者よりご連絡いたします📩',
      });

    default:
      return;
  }
}

function quick(event, question, choices) {
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: question,
    quickReply: {
      items: choices.map(label => ({
        type: 'action',
        action: {
          type: 'message',
          label,
          text: label,
        },
      })),
    },
  });
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on ${port}`));

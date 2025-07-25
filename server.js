const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const axios = require('axios');
const FormData = require('form-data');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());
app.use(middleware({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
}));

const client = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
});

const GAS_ENDPOINT = process.env.GAS_ENDPOINT;
const IMGUR_CLIENT_ID = process.env.IMGUR_CLIENT_ID;

const questions = {
  1: '本名（氏名）を教えてください。',
  2: '面接希望日を教えてください。（例：7月25日 15:00〜）',
  3: '経験はありますか？',
  4: '過去に在籍していた店舗名があれば教えてください。',
  5: 'タトゥーや鯖（スジ彫り）はありますか？',
  6: '顔写真または全身写真を送ってください。'
};

const answers = {};
const currentQuestion = {};

app.post('/webhook', async (req, res) => {
  Promise.all(req.body.events.map(handleEvent)).then(() => res.status(200).end());
});

async function handleEvent(event) {
  const userId = event.source.userId;

  if (event.type === 'message') {
    const message = event.message;

    // 画像処理
    if (message.type === 'image' && currentQuestion[userId] === 6) {
      const buffer = await downloadImage(message.id);
      const imgurUrl = await uploadToImgur(buffer);
      if (imgurUrl) {
        answers[userId][6] = imgurUrl;
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: 'ありがとうございました！内容を確認して担当者よりご連絡いたします。'
        });
        await sendToGAS(userId);
        delete answers[userId];
        delete currentQuestion[userId];
      } else {
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: '画像のアップロードに失敗しました。もう一度お試しください。'
        });
      }
      return;
    }

    // 初期メッセージ
    if (message.type === 'text' && ['こんにちは', 'スタート'].includes(message.text.trim())) {
      answers[userId] = {};
      currentQuestion[userId] = 1;
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: questions[1]
      });
      return;
    }

    // テキスト回答
    if (message.type === 'text' && currentQuestion[userId]) {
      answers[userId][currentQuestion[userId]] = message.text;
      currentQuestion[userId]++;
      const nextQ = questions[currentQuestion[userId]];
      if (nextQ) {
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: nextQ
        });
      } else {
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: '最後に画像を送信してください（顔写真または全身写真）。'
        });
      }
    }
  }
}

async function downloadImage(messageId) {
  const response = await axios.get(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    responseType: 'arraybuffer',
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
    }
  });
  return Buffer.from(response.data, 'binary');
}

async function uploadToImgur(imageBuffer) {
  const form = new FormData();
  form.append('image', imageBuffer.toString('base64'));

  try {
    const response = await axios.post('https://api.imgur.com/3/image', form, {
      headers: {
        Authorization: `Client-ID ${IMGUR_CLIENT_ID}`,
        ...form.getHeaders()
      }
    });
    return response.data.data.link;
  } catch (error) {
    console.error('Imgur upload error:', error.message);
    return null;
  }
}

async function sendToGAS(userId) {
  const data = answers[userId];
  const payload = {
    userId,
    name: data["1"] || '',
    date: data["2"] || '',
    experience: data["3"] || '',
    previousShop: data["4"] || '',
    tattoo: data["5"] || '',
    imageUrl: data["6"] || ''
  };

  try {
    await axios.post(GAS_ENDPOINT, payload);
    console.log('✅ Data sent to GAS:', payload);
  } catch (err) {
    console.error('❌ Error sending to GAS:', err.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

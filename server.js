const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const config = {
  channelAccessToken: 'YOUR_CHANNEL_ACCESS_TOKEN',
  channelSecret: 'YOUR_CHANNEL_SECRET',
};

const GAS_ENDPOINT = 'YOUR_GAS_WEBHOOK_URL';

const client = new line.Client(config);

// アンケート項目
const questions = [
  { key: 'name', text: '1. お名前を教えてください。' },
  { key: 'date', text: '2. 面接希望日を教えてください。（例：7月26日 15:00〜）' },
  {
    key: 'experience',
    text: '3. 経験はありますか？',
    options: ['あり', 'なし']
  },
  { key: 'pastShop', text: '4. 過去に在籍していた店舗名があれば教えてください。' },
  {
    key: 'tattoo',
    text: '5. タトゥーやスジ彫りはありますか？',
    options: ['あり', 'なし']
  },
  { key: 'photo', text: '6. 顔写真または全身写真を送ってください。' }
];

const userStates = {};

app.post('/webhook', line.middleware(config), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    const userId = event.source.userId;

    if (!userStates[userId]) {
      userStates[userId] = { current: 0, answers: {} };
    }

    const state = userStates[userId];

    // 画像アップロード処理
    if (event.message && event.message.type === 'image') {
      const messageId = event.message.id;
      const imageBuffer = await client.getMessageContent(messageId).then((stream) => {
        return new Promise((resolve, reject) => {
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', reject);
        });
      });

      const filename = `${userId}_${Date.now()}.jpg`;
      const tempPath = path.join(__dirname, filename);
      fs.writeFileSync(tempPath, imageBuffer);

      const form = new FormData();
      form.append('image', fs.createReadStream(tempPath));
      form.append('userId', userId);
      form.append('questionKey', questions[state.current].key);

      try {
        const response = await axios.post(GAS_ENDPOINT, form, {
          headers: form.getHeaders()
        });

        const imageUrl = response.data.imageUrl || '';
        state.answers[questions[state.current].key] = imageUrl;
      } catch (error) {
        console.error('画像アップロード失敗:', error);
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: '画像の保存に失敗しました。もう一度お試しください。'
        });
        return;
      } finally {
        fs.unlinkSync(tempPath);
      }

      state.current += 1;
    }

    // テキスト・選択式対応
    if (event.message && event.message.type === 'text') {
      const answer = event.message.text;
      const question = questions[state.current];

      if (question && question.key !== 'photo') {
        state.answers[question.key] = answer;
        state.current += 1;
      }
    }

    // 次の質問を送信
    if (state.current < questions.length) {
      const nextQuestion = questions[state.current];

      // QuickReply形式
      if (nextQuestion.options) {
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: nextQuestion.text,
          quickReply: {
            items: nextQuestion.options.map(opt => ({
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
          text: nextQuestion.text
        });
      }
    } else {
      // すべての質問が完了 → GASに送信
      try {
        await axios.post(GAS_ENDPOINT, {
          userId,
          ...state.answers
        });
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: 'ご回答ありがとうございました！内容を確認の上、担当者よりご連絡いたします。'
        });
      } catch (e) {
        console.error('保存失敗', e);
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: '保存中にエラーが発生しました。もう一度お試しください。'
        });
      }

      delete userStates[userId];
    }
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

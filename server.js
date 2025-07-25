const express = require('express');
const { google } = require('googleapis');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const line = require('@line/bot-sdk');

const app = express();
const port = process.env.PORT || 3000;

const config = {
  channelAccessToken: 'vTdm94c2EPcZs3p7ktHfVvch8HHZ64/rD5SWKmm7jEfl+S0Lw12WvRUSTN1h3q6ymJUGlfMBmUEi8u+5IebXDe9UTQXvfM8ABDfEIShRSvghvsNEQD0Ms+vX3tOy9zo3EpJL8oE0ltSGHIZFskwNagdB04t89/1O/w1cDnyilFU=',
  channelSecret: '1564c7045280f8e5de962041ffb6568b'
};

const client = new line.Client(config);
app.use(express.json());

const userStates = new Map();

// アンケート構造
const questions = [
  {
    key: '希望日',
    text: '面接希望日を選んでください（10日先まで）',
    type: 'date',
  },
  {
    key: '希望時間',
    text: '希望する時間帯を選んでください（15時〜22時）',
    type: 'time',
  },
  {
    key: '名前',
    text: '本名（氏名）を教えてください。',
    type: 'text',
  },
  {
    key: '経験有無',
    text: '経験はありますか？',
    type: 'select',
    options: ['あり', 'なし']
  },
  {
    key: '過去在籍店舗',
    text: '過去に在籍していた店舗名があれば教えてください。',
    type: 'text'
  },
  {
    key: 'タトゥー・傷の有無',
    text: 'タトゥーや傷（スジ彫り）はありますか？',
    type: 'select',
    options: ['あり', 'なし']
  },
  {
    key: '写真URL',
    text: '顔写真または全身写真を送信してください。',
    type: 'image'
  }
];

// 日付オプション生成
function generateDateOptions() {
  const today = new Date();
  const options = [];

  for (let i = 0; i < 10; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const label = `${date.getMonth() + 1}月${date.getDate()}日`;
    options.push({ type: 'action', action: { type: 'message', label, text: label } });
  }

  options.push({ type: 'action', action: { type: 'message', label: 'それ以外', text: 'それ以外' } });
  return options;
}

// 時間オプション
function generateTimeOptions() {
  const options = [];
  for (let h = 15; h <= 22; h++) {
    options.push({ type: 'action', action: { type: 'message', label: `${h}時`, text: `${h}時` } });
  }
  return options;
}

// アンケート送信
async function sendQuestion(event, index) {
  const userId = event.source.userId;
  const question = questions[index];

  let message;

  if (question.type === 'select') {
    message = {
      type: 'text',
      text: question.text,
      quickReply: {
        items: question.options.map(opt => ({
          type: 'action',
          action: { type: 'message', label: opt, text: opt }
        }))
      }
    };
  } else if (question.type === 'date') {
    message = {
      type: 'text',
      text: question.text,
      quickReply: {
        items: generateDateOptions()
      }
    };
  } else if (question.type === 'time') {
    message = {
      type: 'text',
      text: question.text,
      quickReply: {
        items: generateTimeOptions()
      }
    };
  } else {
    message = { type: 'text', text: question.text };
  }

  await client.replyMessage(event.replyToken, message);
}

// LINE Webhook
app.post('/webhook', line.middleware(config), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    const userId = event.source.userId;
    if (!userStates.has(userId)) {
      userStates.set(userId, { answers: {}, step: 0 });
    }

    const state = userStates.get(userId);

    // 画像受信
    if (event.message?.type === 'image' && questions[state.step]?.type === 'image') {
      try {
        const stream = await client.getMessageContent(event.message.id);
        const buffer = await streamToBuffer(stream);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `${userId}_${timestamp}.jpg`;
        const tempPath = `/tmp/${fileName}`;
        fs.writeFileSync(tempPath, buffer);

        const form = new FormData();
        form.append('file', fs.createReadStream(tempPath));
        form.append('userId', userId);
        form.append('fileName', fileName);

        const driveRes = await axios.post('https://script.google.com/macros/s/AKfycbxDN14UbuIVIXZNj-RWGIE5G6lUqnG6I9AEmsEDNKttEsAGmkCVrd0CscBMdRqiP7AK0Q/exec', form, {
          headers: form.getHeaders()
        });

        state.answers[questions[state.step].key] = driveRes.data.fileUrl || '画像アップロード失敗';
        state.step++;

        if (state.step < questions.length) {
          await sendQuestion(event, state.step);
        } else {
          await sendSummary(userId, state.answers);
          userStates.delete(userId);
        }

        fs.unlinkSync(tempPath);
      } catch (err) {
        console.error('画像処理エラー:', err);
      }
    }

    // テキスト/選択肢
    else if (event.type === 'message' && event.message.type === 'text') {
      const answer = event.message.text;
      const currentQuestion = questions[state.step];

      // 'それ以外' の後は手入力として扱う
      if (currentQuestion.key === '希望日' && answer === 'それ以外') {
        state.answers[currentQuestion.key] = 'それ以外';
        state.step++;
        await sendQuestion(event, state.step);
      } else {
        state.answers[currentQuestion.key] = answer;
        state.step++;

        if (state.step < questions.length) {
          await sendQuestion(event, state.step);
        } else {
          await sendSummary(userId, state.answers);
          userStates.delete(userId);
        }
      }
    }

    // 最初の起動
    else if (event.type === 'follow' || event.message?.text === 'スタート' || event.message?.text === 'こんにちは') {
      userStates.set(userId, { answers: {}, step: 0 });
      await sendQuestion(event, 0);
    }
  }

  res.sendStatus(200);
});

// サマリ送信
async function sendSummary(userId, answers) {
  const summary = Object.entries(answers).map(([key, value]) => `${key}：${value}`).join('\n');

  await client.pushMessage(userId, {
    type: 'text',
    text: `以下の内容で受け付けました。\n\n${summary}\n\nご回答ありがとうございました！`
  });
}

// Stream変換
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

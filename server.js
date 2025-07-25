const express = require('express');
const { middleware, Client } = require('@line/bot-sdk');
const axios = require('axios');
const app = express();
app.use(express.json());

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new Client(config);
const userStates = {};

app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      await handleText(event);
    }
  }
  res.sendStatus(200);
});

async function handleText(event) {
  const userId = event.source.userId;
  const message = event.message.text;

  if (!userStates[userId]) {
    userStates[userId] = {};
    return await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '本名（氏名）を教えてください。'
    });
  }

  const state = userStates[userId];

  if (!state.name) {
    state.name = message;
    return await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '面接希望日を選んでください（今日から10日以内）',
      quickReply: {
        items: getDateQuickReplies()
      }
    });
  }

  if (!state.date) {
    if (message === 'それ以外の日付を希望する') {
      state.waitingCustomDate = true;
      return await client.replyMessage(event.replyToken, {
        type: 'text',
        text: '面接希望日を入力してください（例：7月31日）'
      });
    } else {
      state.date = message;
      return await client.replyMessage(event.replyToken, {
        type: 'text',
        text: '希望時間帯を選んでください',
        quickReply: {
          items: getTimeQuickReplies()
        }
      });
    }
  }

  if (state.waitingCustomDate) {
    state.date = message;
    delete state.waitingCustomDate;
    return await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '希望時間帯を選んでください',
      quickReply: {
        items: getTimeQuickReplies()
      }
    });
  }

  if (!state.time) {
    state.time = message;
    await sendToGAS({ userId, ...state });
    delete userStates[userId];
    return await client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ご回答ありがとうございました！担当者よりご連絡いたします。'
    });
  }
}

// QuickReply日付生成（当日〜10日後）
function getDateQuickReplies() {
  const replies = [];
  const today = new Date();
  for (let i = 0; i <= 10; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const formatted = `${date.getMonth() + 1}月${date.getDate()}日`;
    replies.push({
      type: 'action',
      action: {
        type: 'message',
        label: formatted,
        text: formatted
      }
    });
  }
  replies.push({
    type: 'action',
    action: {
      type: 'message',
      label: 'それ以外の日付を希望する',
      text: 'それ以外の日付を希望する'
    }
  });
  return replies;
}

// QuickReply時間生成（15時〜22時）
function getTimeQuickReplies() {
  const replies = [];
  for (let h = 15; h <= 22; h++) {
    const label = `${h}:00`;
    replies.push({
      type: 'action',
      action: {
        type: 'message',
        label,
        text: label
      }
    });
  }
  return replies;
}

// Google Apps Scriptへ送信
async function sendToGAS(data) {
  try {
    await axios.post(process.env.GAS_ENDPOINT, data);
  } catch (err) {
    console.error('GAS送信エラー:', err.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});

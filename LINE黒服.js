
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

const CHANNEL_ACCESS_TOKEN = 'YOUR_LINE_CHANNEL_ACCESS_TOKEN';
const GAS_URL = 'https://script.google.com/macros/s/your-gas-url/exec';

const questions = [
  { key: 'nickname', text: 'ニックネームを教えてください（LINE上の呼び名など）' },
  { key: 'age', text: '年齢を教えてください（数字で回答してください）' },
  { key: 'employmentType', text: '希望する雇用形態を選んでください：', options: ['正社員', 'アルバイト', 'どちらでもよい'] },
  { key: 'area', text: '希望する勤務エリアを選んでください：', options: ['北新地', 'ミナミ', 'その他'] },
  { key: 'jobType', text: '希望する職種を選んでください：', options: ['ホール', 'バーテンダー', '送迎', '黒服'] },
  { key: 'experience', text: '夜職の経験はありますか？', options: ['未経験', '経験あり'] },
  { key: 'pastSalary', text: '過去の時給または月給を教えてください（例：時給1,400円など）' },
  { key: 'shiftFrequency', text: '希望するシフト頻度を選んでください：', options: ['週1〜2日', '週3〜4日', '週5日以上'] },
  { key: 'availableTime', text: '勤務可能な時間帯を教えてください（例：19時〜ラストなど）' }
];

const sessions = {};

async function replyText(replyToken, message) {
  await axios.post(
    'https://api.line.me/v2/bot/message/reply',
    {
      replyToken,
      messages: [{ type: 'text', text: message }],
    },
    {
      headers: {
        Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

async function replyQuickReply(replyToken, questionText, options) {
  const items = options.map(option => ({
    type: 'action',
    action: {
      type: 'message',
      label: option,
      text: option
    }
  }));

  await axios.post(
    'https://api.line.me/v2/bot/message/reply',
    {
      replyToken,
      messages: [{
        type: 'text',
        text: questionText,
        quickReply: {
          items
        }
      }]
    },
    {
      headers: {
        Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      }
    }
  );
}

async function saveToSheet(userId, data) {
  try {
    const response = await axios.post(GAS_URL, {
      userId,
      ...data,
    });
    console.log('✅ GASに送信完了:', response.data);
  } catch (err) {
    console.error('❌ GAS送信エラー:', err.message);
  }
}

async function sendNextQuestion(userId, replyToken) {
  const session = sessions[userId];
  const step = session.step;
  const question = questions[step];

  if (!question) {
    await replyText(replyToken, 'システムエラー：質問が見つかりませんでした。');
    return;
  }

  if (question.options) {
    await replyQuickReply(replyToken, question.text, question.options);
  } else {
    await replyText(replyToken, question.text);
  }
}

function generateSummary(answers) {
  const summaryLines = questions.map(q => `【${q.text.replace(/：$/, '')}】\n${answers[q.key] || '未回答'}`);
  return summaryLines.join('\n\n');
}

app.post('/webhook', async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type !== 'message' || event.message.type !== 'text') continue;

    const userId = event.source.userId;
    const text = event.message.text.trim();
    const replyToken = event.replyToken;

    if (text.includes('登録') || text.includes('やり直し')) {
      sessions[userId] = { step: 0, answers: {} };
      await sendNextQuestion(userId, replyToken);
      continue;
    }

    if (!sessions[userId]) {
      sessions[userId] = { step: 0, answers: {} };
      await sendNextQuestion(userId, replyToken);
      continue;
    }

    const session = sessions[userId];
    const step = session.step;
    const currentQuestion = questions[step];
    if (currentQuestion) {
      session.answers[currentQuestion.key] = text;
      session.step++;
    }

    if (session.step < questions.length) {
      await sendNextQuestion(userId, replyToken);
    } else {
      await saveToSheet(userId, session.answers);
      const summary = generateSummary(session.answers);
      await replyText(replyToken, 'アンケートのご回答ありがとうございました！\n\n以下があなたの回答内容です：\n\n' + summary);
      delete sessions[userId];
    }
  }

  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('✅ LINEアンケートBot（Render対応）稼働中');
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

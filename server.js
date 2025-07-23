const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const bodyParser = require('body-parser');
const app = express();

// ✅ Renderの環境変数に合わせて修正
const LINE_CHANNEL_SECRET = process.env.CHANNEL_SECRET;
const GAS_ENDPOINT = process.env.GAS_URL;

app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
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

  if (!validateSignature(signature, req.rawBody)) {
    console.error('❌ 署名検証に失敗しました');
    return res.status(401).send('Unauthorized');
  }

  const events = req.body.events;

  if (!events || events.length === 0) {
    console.log('⚠️ イベントが空です');
    return res.status(200).send('No events');
  }

  try {
    const userId = events[0]?.source?.userId || 'unknown';
    const testData = {
      userId: userId,
      name: 'テスト太郎',
      jobType: 'ホールスタッフ',
      area: '渋谷',
      days: '週3日',
      experience: '未経験',
      pr: 'よろしくお願いします！'
    };

    const response = await axios.post(GAS_ENDPOINT, testData);
    console.log('✅ GAS送信成功:', response.status);
    return res.status(200).send('OK');
  } catch (error) {
    console.error('❌ GAS送信エラー:', error.message);
    return res.status(500).send('Internal Server Error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const bodyParser = require('body-parser');
const app = express();

// LINEのチャネルシークレットを使って署名検証
const LINE_CHANNEL_SECRET = '★ここに自分のチャネルシークレット★';
const GAS_ENDPOINT = '★GASのWebhook URL★';

// rawBodyを扱うための設定
app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// 署名検証関数
function validateSignature(signature, body) {
  const hash = crypto
    .createHmac('SHA256', LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return signature === hash;
}

// メインWebhookエンドポイント
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];

  if (!validateSignature(signature, req.rawBody)) {
    return res.status(401).send('Unauthorized');
  }

  const events = req.body.events;

  // テスト送信用
  try {
    const userId = events[0]?.source?.userId || '';
    const testData = {
      userId: userId,
      name: 'テスト太郎',
      jobType: 'ホールスタッフ',
      area: '渋谷',
      days: '週3日',
      experience: '未経験',
      pr: 'よろしくお願いします！'
    };

    await axios.post(GAS_ENDPOINT, testData);
    return res.status(200).send('OK');
  } catch (error) {
    console.error('GAS送信エラー:', error);
    return res.status(500).send('Internal Server Error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

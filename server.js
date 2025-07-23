const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const bodyParser = require('body-parser');
const app = express();

// ★重要：Renderなどの環境変数を使う（セキュア）
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '★ここにチャネルシークレット★';
const GAS_ENDPOINT = process.env.GAS_ENDPOINT || '★ここにGASエンドポイント★';

// rawBody取得の設定（署名検証用）
app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString(); // ←ここ重要
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

// Webhookエンドポイント
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];

  // 署名不一致 → 拒否
  if (!validateSignature(signature, req.rawBody)) {
    console.error('署名検証失敗');
    return res.status(401).send('Unauthorized');
  }

  const events = req.body.events;

  // イベントがない場合
  if (!events || events.length === 0) {
    console.log('イベントが空です');
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
    console.log('GAS応答:', response.status);
    return res.status(200).send('OK');
  } catch (error) {
    console.error('GAS送信エラー:', error.message);
    return res.status(500).send('Internal Server Error');
  }
});

// サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { image, mediaType } = req.body;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: image }
            },
            {
              type: 'text',
              text: `このレシートまたは領収書を解析してください。以下のJSON形式のみで返答してください。他の文章は不要です。
{
  "date": "YYYY-MM-DD形式の日付",
  "store": "店名・取引先",
  "amount_with_tax": 税込金額の数値,
  "amount_without_tax": 税抜金額の数値,
  "tax_amount": 消費税額の数値,
  "payment_method": "現金またはPayPayまたはクレジットカード",
  "account_title": "勘定科目（食料品費・消耗品費・交際費・水道光熱費・通信費・その他のいずれか）",
  "memo": "備考があれば"
}
日付が読み取れない場合は今日の日付、金額が読み取れない場合は0を入れてください。
支払方法の記載がない場合は現金としてください。`
            }
          ]
        }]
      })
    });

    const data = await response.json();
    const text = data.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

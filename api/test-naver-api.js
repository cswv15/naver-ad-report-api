const axios = require('axios');
const crypto = require('crypto');

function generateSignature(timestamp, method, uri, secretKey) {
  const message = `${timestamp}.${method}.${uri}`;
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(message)
    .digest('base64');
  return signature;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { customerId, apiKey, secretKey } = req.body;

  if (!customerId || !apiKey || !secretKey) {
    return res.status(400).json({
      error: 'Missing required parameters',
      required: ['customerId', 'apiKey', 'secretKey']
    });
  }

  const results = [];
  
  // 테스트할 여러 엔드포인트들
  const endpoints = [
    '/ncc/stats',
    '/stats',
    '/ncc/campaigns',
    '/master-report',
    '/stat-reports'
  ];

  for (const endpoint of endpoints) {
    const timestamp = Date.now().toString();
    const method = 'GET';
    const signature = generateSignature(timestamp, method, endpoint, secretKey);

    try {
      const response = await axios.get(`https://api.naver.com${endpoint}`, {
        params: {
          ids: customerId,
          fields: JSON.stringify(['impCnt', 'clkCnt', 'salesAmt'])
        },
        headers: {
          'X-API-KEY': apiKey,
          'X-Customer': customerId,
          'X-Timestamp': timestamp,
          'X-Signature': signature,
          'Content-Type': 'application/json; charset=UTF-8'
        },
        timeout: 5000
      });

      results.push({
        endpoint: endpoint,
        status: 'SUCCESS',
        statusCode: response.status,
        data: response.data
      });
    } catch (error) {
      results.push({
        endpoint: endpoint,
        status: 'FAILED',
        statusCode: error.response?.status || 'TIMEOUT',
        error: error.response?.data || error.message
      });
    }
  }

  return res.status(200).json({
    message: 'Endpoint test completed',
    results: results
  });
};

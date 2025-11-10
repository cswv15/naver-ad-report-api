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

function formatDate(year, month) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
  return { startDate, endDate };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { customerId, apiKey, secretKey, year, month } = req.body;

    if (!customerId || !apiKey || !secretKey || !year || !month) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: ['customerId', 'apiKey', 'secretKey', 'year', 'month']
      });
    }

    const { startDate, endDate } = formatDate(parseInt(year), parseInt(month));

    const BASE_URL = 'https://api.searchad.naver.com';
    const timestamp = Date.now().toString();
    const method = 'GET';
    
    // 테스트할 여러 엔드포인트들
    const endpoints = [
      '/ncc/master-report',
      '/ncc/stat-reports',
      '/master-report',
      '/stat-reports',
      '/ncc/stats',
      '/stats',
      '/reports',
      '/ncc/reports'
    ];

    const results = [];

    for (const endpoint of endpoints) {
      try {
        const signature = generateSignature(timestamp, method, endpoint, secretKey);
        
        const response = await axios.get(`${BASE_URL}${endpoint}`, {
          params: {
            ids: `cus-${customerId}`,
            fields: JSON.stringify(['impCnt', 'clkCnt', 'salesAmt']),
            timeRange: JSON.stringify({
              since: startDate,
              until: endDate
            })
          },
          headers: {
            'X-API-KEY': apiKey,
            'X-CUSTOMER': customerId,
            'X-TIMESTAMP': timestamp,
            'X-SIGNATURE': signature,
            'Content-Type': 'application/json; charset=UTF-8'
          },
          timeout: 5000
        });
        
        results.push({
          endpoint: endpoint,
          status: 'SUCCESS',
          statusCode: response.status,
          dataType: Array.isArray(response.data) ? 'array' : typeof response.data,
          dataLength: Array.isArray(response.data) ? response.data.length : 'N/A',
          sampleData: response.data
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
      message: 'Endpoint discovery completed',
      baseUrl: BASE_URL,
      period: { startDate, endDate },
      results: results,
      summary: {
        total: results.length,
        success: results.filter(r => r.status === 'SUCCESS').length,
        failed: results.filter(r => r.status === 'FAILED').length
      }
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

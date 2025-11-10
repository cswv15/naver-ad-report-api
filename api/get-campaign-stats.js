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
    const API_PATH = '/stat-reports';
    const timestamp = Date.now().toString();
    const method = 'GET';
    
    const signature = generateSignature(timestamp, method, API_PATH, secretKey);

    // 여러 파라미터 조합 테스트
    const attempts = [];

    // Attempt 1: 기본 (breakdown 있음)
    try {
      const res1 = await axios.get(`${BASE_URL}${API_PATH}`, {
        params: {
          ids: customerId,
          fields: JSON.stringify(['impCnt', 'clkCnt', 'salesAmt', 'ctr', 'cpc']),
          timeRange: JSON.stringify({ since: startDate, until: endDate }),
          breakdown: 'nccCampaignId'
        },
        headers: {
          'X-API-KEY': apiKey,
          'X-CUSTOMER': customerId,
          'X-TIMESTAMP': timestamp,
          'X-SIGNATURE': signature,
          'Content-Type': 'application/json; charset=UTF-8'
        }
      });
      attempts.push({
        name: 'With breakdown',
        status: 'SUCCESS',
        isEmpty: !res1.data || res1.data === '' || (Array.isArray(res1.data) && res1.data.length === 0),
        data: res1.data
      });
    } catch (e) {
      attempts.push({
        name: 'With breakdown',
        status: 'FAILED',
        error: e.response?.data || e.message
      });
    }

    // Attempt 2: breakdown 없음
    try {
      const res2 = await axios.get(`${BASE_URL}${API_PATH}`, {
        params: {
          ids: customerId,
          fields: JSON.stringify(['impCnt', 'clkCnt', 'salesAmt', 'ctr', 'cpc']),
          timeRange: JSON.stringify({ since: startDate, until: endDate })
        },
        headers: {
          'X-API-KEY': apiKey,
          'X-CUSTOMER': customerId,
          'X-TIMESTAMP': timestamp,
          'X-SIGNATURE': signature,
          'Content-Type': 'application/json; charset=UTF-8'
        }
      });
      attempts.push({
        name: 'Without breakdown',
        status: 'SUCCESS',
        isEmpty: !res2.data || res2.data === '' || (Array.isArray(res2.data) && res2.data.length === 0),
        data: res2.data
      });
    } catch (e) {
      attempts.push({
        name: 'Without breakdown',
        status: 'FAILED',
        error: e.response?.data || e.message
      });
    }

    // Attempt 3: 파라미터 최소화
    try {
      const res3 = await axios.get(`${BASE_URL}${API_PATH}`, {
        params: {
          ids: customerId,
          fields: JSON.stringify(['salesAmt', 'clkCnt']),
          timeRange: JSON.stringify({ since: startDate, until: endDate })
        },
        headers: {
          'X-API-KEY': apiKey,
          'X-CUSTOMER': customerId,
          'X-TIMESTAMP': timestamp,
          'X-SIGNATURE': signature
        }
      });
      attempts.push({
        name: 'Minimal params',
        status: 'SUCCESS',
        isEmpty: !res3.data || res3.data === '' || (Array.isArray(res3.data) && res3.data.length === 0),
        data: res3.data
      });
    } catch (e) {
      attempts.push({
        name: 'Minimal params',
        status: 'FAILED',
        error: e.response?.data || e.message
      });
    }

    // Attempt 4: ids 없이
    try {
      const res4 = await axios.get(`${BASE_URL}${API_PATH}`, {
        params: {
          fields: JSON.stringify(['salesAmt', 'clkCnt']),
          timeRange: JSON.stringify({ since: startDate, until: endDate })
        },
        headers: {
          'X-API-KEY': apiKey,
          'X-CUSTOMER': customerId,
          'X-TIMESTAMP': timestamp,
          'X-SIGNATURE': signature
        }
      });
      attempts.push({
        name: 'Without ids',
        status: 'SUCCESS',
        isEmpty: !res4.data || res4.data === '' || (Array.isArray(res4.data) && res4.data.length === 0),
        data: res4.data
      });
    } catch (e) {
      attempts.push({
        name: 'Without ids',
        status: 'FAILED',
        error: e.response?.data || e.message
      });
    }

    return res.status(200).json({
      message: 'Parameter testing completed',
      period: { startDate, endDate },
      attempts: attempts,
      summary: {
        total: attempts.length,
        success: attempts.filter(a => a.status === 'SUCCESS').length,
        withData: attempts.filter(a => a.status === 'SUCCESS' && !a.isEmpty).length
      }
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

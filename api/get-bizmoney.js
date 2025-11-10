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
    const results = {};

    // 시도 1: /bizmoney (잔액 조회)
    try {
      const ts1 = Date.now().toString();
      const path1 = '/bizmoney';
      const sig1 = generateSignature(ts1, 'GET', path1, secretKey);

      const response1 = await axios.get(`${BASE_URL}${path1}`, {
        headers: {
          'X-API-KEY': apiKey,
          'X-CUSTOMER': customerId,
          'X-TIMESTAMP': ts1,
          'X-SIGNATURE': sig1,
          'Content-Type': 'application/json; charset=UTF-8'
        }
      });

      results.bizmoney = {
        success: true,
        data: response1.data
      };
    } catch (error) {
      results.bizmoney = {
        success: false,
        status: error.response?.status,
        error: error.response?.data || error.message
      };
    }

    // 시도 2: /bizmoney/cost (일별 소진액)
    try {
      const ts2 = Date.now().toString();
      const path2 = '/bizmoney/cost';
      const sig2 = generateSignature(ts2, 'GET', path2, secretKey);

      const response2 = await axios.get(`${BASE_URL}${path2}`, {
        params: {
          startDate: startDate,
          endDate: endDate
        },
        headers: {
          'X-API-KEY': apiKey,
          'X-CUSTOMER': customerId,
          'X-TIMESTAMP': ts2,
          'X-SIGNATURE': sig2,
          'Content-Type': 'application/json; charset=UTF-8'
        }
      });

      results.bizMoneyCost = {
        success: true,
        data: response2.data
      };
    } catch (error) {
      results.bizMoneyCost = {
        success: false,
        status: error.response?.status,
        error: error.response?.data || error.message
      };
    }

    // 시도 3: /bizmoney/getCost (다른 형식)
    try {
      const ts3 = Date.now().toString();
      const path3 = '/bizmoney/getCost';
      const sig3 = generateSignature(ts3, 'POST', path3, secretKey);

      const response3 = await axios.post(`${BASE_URL}${path3}`, {
        startDate: startDate,
        endDate: endDate
      }, {
        headers: {
          'X-API-KEY': apiKey,
          'X-CUSTOMER': customerId,
          'X-TIMESTAMP': ts3,
          'X-SIGNATURE': sig3,
          'Content-Type': 'application/json; charset=UTF-8'
        }
      });

      results.getCost = {
        success: true,
        data: response3.data
      };
    } catch (error) {
      results.getCost = {
        success: false,
        status: error.response?.status,
        error: error.response?.data || error.message
      };
    }

    // 시도 4: /stats (다른 파라미터 형식)
    try {
      const ts4 = Date.now().toString();
      const path4 = '/stats';
      const sig4 = generateSignature(ts4, 'GET', path4, secretKey);

      const response4 = await axios.get(`${BASE_URL}${path4}`, {
        params: {
          timeRange: JSON.stringify({
            since: startDate,
            until: endDate
          }),
          fields: JSON.stringify(['impCnt', 'clkCnt', 'salesAmt'])
        },
        headers: {
          'X-API-KEY': apiKey,
          'X-CUSTOMER': customerId,
          'X-TIMESTAMP': ts4,
          'X-SIGNATURE': sig4,
          'Content-Type': 'application/json; charset=UTF-8'
        }
      });

      results.statsNoId = {
        success: true,
        data: response4.data
      };
    } catch (error) {
      results.statsNoId = {
        success: false,
        status: error.response?.status,
        error: error.response?.data || error.message
      };
    }

    // 시도 5: /ncc/stats (ncc prefix)
    try {
      const ts5 = Date.now().toString();
      const path5 = '/ncc/stats';
      const sig5 = generateSignature(ts5, 'GET', path5, secretKey);

      const response5 = await axios.get(`${BASE_URL}${path5}`, {
        params: {
          timeRange: JSON.stringify({
            since: startDate,
            until: endDate
          }),
          fields: JSON.stringify(['impCnt', 'clkCnt', 'salesAmt'])
        },
        headers: {
          'X-API-KEY': apiKey,
          'X-CUSTOMER': customerId,
          'X-TIMESTAMP': ts5,
          'X-SIGNATURE': sig5,
          'Content-Type': 'application/json; charset=UTF-8'
        }
      });

      results.nccStats = {
        success: true,
        data: response5.data
      };
    } catch (error) {
      results.nccStats = {
        success: false,
        status: error.response?.status,
        error: error.response?.data || error.message
      };
    }

    return res.status(200).json({
      success: true,
      period: {
        year: year,
        month: month,
        startDate: startDate,
        endDate: endDate
      },
      results: results,
      message: 'Tested multiple API endpoints'
    });

  } catch (error) {
    console.error('API Error:', error.response?.data || error.message);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || 'Unknown error occurred'
    });
  }
};

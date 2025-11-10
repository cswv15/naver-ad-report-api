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

    // StatReport Job 생성 (올바른 형식)
    const postSignature = generateSignature(timestamp, 'POST', API_PATH, secretKey);
    
    const reportJobRequest = {
      item: 'AD',  // ✅ "item" 키 사용!
      statDt: startDate,
      statEdDt: endDate
    };

    const createResponse = await axios.post(`${BASE_URL}${API_PATH}`, reportJobRequest, {
      headers: {
        'X-API-KEY': apiKey,
        'X-CUSTOMER': customerId,
        'X-TIMESTAMP': timestamp,
        'X-SIGNATURE': postSignature,
        'Content-Type': 'application/json; charset=UTF-8'
      }
    });

    const reportJobId = createResponse.data.id;
    let status = createResponse.data.status;

    if (!reportJobId) {
      return res.status(500).json({
        success: false,
        error: 'Report Job ID not found',
        response: createResponse.data
      });
    }

    // Report 완료 대기
    let attempts = 0;
    const maxAttempts = 20;

    while ((status === 'REGIST' || status === 'RUNNING') && attempts < maxAttempts) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 3000));

      const getTimestamp = Date.now().toString();
      const getPath = `${API_PATH}/${reportJobId}`;
      const getSignature = generateSignature(getTimestamp, 'GET', getPath, secretKey);

      const getResponse = await axios.get(`${BASE_URL}${getPath}`, {
        headers: {
          'X-API-KEY': apiKey,
          'X-CUSTOMER': customerId,
          'X-TIMESTAMP': getTimestamp,
          'X-SIGNATURE': getSignature,
          'Content-Type': 'application/json; charset=UTF-8'
        }
      });

      status = getResponse.data.status;

      if (status === 'BUILT') {
        return res.status(200).json({
          success: true,
          period: {
            year: year,
            month: month,
            startDate: startDate,
            endDate: endDate
          },
          reportJobId: reportJobId,
          downloadUrl: getResponse.data.downloadUrl,
          status: status,
          message: 'Ad performance report ready'
        });
      } else if (status === 'ERROR') {
        return res.status(500).json({
          success: false,
          error: 'Report generation failed',
          status: status,
          period: { startDate, endDate }
        });
      } else if (status === 'NONE') {
        return res.status(200).json({
          success: false,
          message: 'No data available for this period',
          status: status,
          period: { startDate, endDate }
        });
      }
    }

    return res.status(500).json({
      success: false,
      error: 'Timeout waiting for report',
      attempts: attempts,
      lastStatus: status,
      period: { startDate, endDate }
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

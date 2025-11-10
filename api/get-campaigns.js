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

  try {
    const { customerId, apiKey, secretKey } = req.body;

    if (!customerId || !apiKey || !secretKey) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: ['customerId', 'apiKey', 'secretKey']
      });
    }

    const BASE_URL = 'https://api.searchad.naver.com';
    const API_PATH = '/master-reports';
    const timestamp = Date.now().toString();

    // MasterReport Job 생성 (올바른 형식: "item" 사용)
    const postSignature = generateSignature(timestamp, 'POST', API_PATH, secretKey);
    
    const reportJobRequest = {
      item: 'Campaign'  // ✅ "item" 키 사용!
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
          reportJobId: reportJobId,
          downloadUrl: getResponse.data.downloadUrl,
          status: status,
          message: 'Campaign master report ready'
        });
      } else if (status === 'ERROR') {
        return res.status(500).json({
          success: false,
          error: 'Report generation failed',
          status: status
        });
      } else if (status === 'NONE') {
        return res.status(200).json({
          success: false,
          message: 'No data available',
          status: status
        });
      }
    }

    return res.status(500).json({
      success: false,
      error: 'Timeout waiting for report',
      attempts: attempts,
      lastStatus: status
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

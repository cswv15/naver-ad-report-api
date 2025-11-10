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

    // STEP 1: MasterReport Job 생성 (Campaign 데이터)
    const postSignature = generateSignature(timestamp, 'POST', API_PATH, secretKey);
    
    const reportJobRequest = {
      reportTp: 'Campaign' // Campaign Master
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

    if (!reportJobId) {
      return res.status(500).json({
        success: false,
        error: 'Report Job ID not found',
        response: createResponse.data
      });
    }

    // STEP 2: Report 상태 확인
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      attempts++;
      
      await new Promise(resolve => setTimeout(resolve, 2000));

      const getTimestamp = Date.now().toString();
      const getPath = `${API_PATH}/${reportJobId}`;
      const getSignature = generateSignature(getTimestamp, 'GET', getPath, secretKey);

      try {
        const getResponse = await axios.get(`${BASE_URL}${getPath}`, {
          headers: {
            'X-API-KEY': apiKey,
            'X-CUSTOMER': customerId,
            'X-TIMESTAMP': getTimestamp,
            'X-SIGNATURE': getSignature,
            'Content-Type': 'application/json; charset=UTF-8'
          }
        });

        const status = getResponse.data.status;

        if (status === 'COMPLETE' || status === 'REGIST') {
          return res.status(200).json({
            success: true,
            reportJobId: reportJobId,
            downloadUrl: getResponse.data.downloadUrl,
            data: getResponse.data,
            message: 'Campaign list ready'
          });
        } else if (status === 'FAILED') {
          return res.status(500).json({
            success: false,
            error: 'Report generation failed',
            details: getResponse.data
          });
        }

      } catch (error) {
        // 재시도
      }
    }

    return res.status(500).json({
      success: false,
      error: 'Timeout waiting for report',
      attempts: attempts
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

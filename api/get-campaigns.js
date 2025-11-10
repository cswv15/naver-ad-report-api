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

    // 여러 Report Type 시도
    const reportTypes = ['Campaign', 'Adgroup', 'Keyword'];
    const results = [];

    for (const reportTp of reportTypes) {
      try {
        const createTimestamp = Date.now().toString();
        const createSignature = generateSignature(createTimestamp, 'POST', API_PATH, secretKey);
        
        const reportJobRequest = {
          reportTp: reportTp
        };

        const createResponse = await axios.post(`${BASE_URL}${API_PATH}`, reportJobRequest, {
          headers: {
            'X-API-KEY': apiKey,
            'X-CUSTOMER': customerId,
            'X-TIMESTAMP': createTimestamp,
            'X-SIGNATURE': createSignature,
            'Content-Type': 'application/json; charset=UTF-8'
          }
        });

        const reportJobId = createResponse.data.id;

        results.push({
          type: reportTp,
          status: 'JOB_CREATED',
          reportJobId: reportJobId,
          createResponse: createResponse.data
        });

        // Job 생성 성공하면 상태 확인
        if (reportJobId) {
          await new Promise(resolve => setTimeout(resolve, 3000));

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

            results[results.length - 1].jobStatus = getResponse.data.status;
            results[results.length - 1].jobData = getResponse.data;

            // 성공하면 즉시 반환
            if (getResponse.data.status === 'REGIST' || getResponse.data.downloadUrl) {
              return res.status(200).json({
                success: true,
                reportType: reportTp,
                reportJobId: reportJobId,
                downloadUrl: getResponse.data.downloadUrl,
                data: getResponse.data,
                message: 'Master report ready',
                allAttempts: results
              });
            }
          } catch (getError) {
            results[results.length - 1].jobError = getError.response?.data || getError.message;
          }
        }

      } catch (createError) {
        results.push({
          type: reportTp,
          status: 'JOB_FAILED',
          error: createError.response?.data || createError.message
        });
      }
    }

    return res.status(200).json({
      success: false,
      message: 'All report types tested',
      results: results
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

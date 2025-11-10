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

    // 여러 Report Type 시도
    const reportTypes = ['AD', 'AD_DETAIL', 'EXPKEYWORD', 'ADEXTENSION'];
    const results = [];

    for (const reportTp of reportTypes) {
      try {
        const timestamp = Date.now().toString();
        const postSignature = generateSignature(timestamp, 'POST', API_PATH, secretKey);
        
const reportJobRequest = {
  reportTp: reportTp,
  statDt: `${startDate}T00:00:00Z`,
  statEdDt: `${endDate}T23:59:59Z`
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

        const reportJobId = createResponse.data.id || createResponse.data.reportJobId;
        let status = createResponse.data.status;

        results.push({
          reportType: reportTp,
          jobCreated: true,
          reportJobId: reportJobId,
          initialStatus: status
        });

        // 성공하면 상태 확인
        if (reportJobId) {
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
          results[results.length - 1].finalStatus = status;
          results[results.length - 1].downloadUrl = getResponse.data.downloadUrl;

          // 성공한 리포트 찾으면 즉시 반환
          if (status === 'COMPLETE' || status === 'BUILT') {
            return res.status(200).json({
              success: true,
              period: {
                year: year,
                month: month,
                startDate: startDate,
                endDate: endDate
              },
              reportType: reportTp,
              reportJobId: reportJobId,
              downloadUrl: getResponse.data.downloadUrl,
              status: status,
              message: `${reportTp} report ready`,
              allAttempts: results
            });
          }
        }

      } catch (error) {
        results.push({
          reportType: reportTp,
          jobCreated: false,
          error: error.response?.data || error.message
        });
      }
    }

    // 모든 시도 결과 반환
    return res.status(200).json({
      success: false,
      message: 'Tried all report types',
      period: {
        year: year,
        month: month,
        startDate: startDate,
        endDate: endDate
      },
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

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

    // STEP 1: Report Job 등록 (POST)
    const postSignature = generateSignature(timestamp, 'POST', API_PATH, secretKey);
    
    // 여러 Report Type 시도
    const reportTypes = [
      {
        name: 'AD Performance Report',
        config: {
          reportTp: 'AD',
          statDt: startDate,
          statEdDt: endDate
        }
      },
      {
        name: 'AD Detail Report',
        config: {
          reportTp: 'AD_DETAIL',
          statDt: startDate,
          statEdDt: endDate
        }
      },
      {
        name: 'Cost Report',
        config: {
          reportTp: 'AD_COST',
          statDt: startDate,
          statEdDt: endDate
        }
      }
    ];

    const results = [];

    for (const reportType of reportTypes) {
      try {
        const createTimestamp = Date.now().toString();
        const createSignature = generateSignature(createTimestamp, 'POST', API_PATH, secretKey);

        const createResponse = await axios.post(`${BASE_URL}${API_PATH}`, reportType.config, {
          headers: {
            'X-API-KEY': apiKey,
            'X-CUSTOMER': customerId,
            'X-TIMESTAMP': createTimestamp,
            'X-SIGNATURE': createSignature,
            'Content-Type': 'application/json; charset=UTF-8'
          }
        });

        const reportJobId = createResponse.data.reportJobId || createResponse.data.id;

        results.push({
          type: reportType.name,
          status: 'JOB_CREATED',
          reportJobId: reportJobId,
          response: createResponse.data
        });

        // Job 생성 성공하면 바로 상태 확인
        if (reportJobId) {
          // 3초 대기 (리포트 생성 시간)
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

            // 성공한 리포트가 있으면 즉시 반환
            if (getResponse.data.status === 'COMPLETE' || getResponse.data.downloadUrl) {
              return res.status(200).json({
                success: true,
                period: {
                  year: year,
                  month: month,
                  startDate: startDate,
                  endDate: endDate
                },
                reportType: reportType.name,
                reportJobId: reportJobId,
                downloadUrl: getResponse.data.downloadUrl,
                data: getResponse.data,
                allAttempts: results
              });
            }
          } catch (getError) {
            results[results.length - 1].jobError = getError.response?.data || getError.message;
          }
        }

      } catch (createError) {
        results.push({
          type: reportType.name,
          status: 'JOB_FAILED',
          error: createError.response?.data || createError.message
        });
      }
    }

    // 모든 시도 결과 반환
    return res.status(200).json({
      success: false,
      message: 'All report types tested',
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

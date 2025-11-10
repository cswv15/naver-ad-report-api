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
    
    const reportJobRequest = {
      reportTp: 'AD', // Ad Performance Report
      statDt: startDate,
      statEdDt: endDate,
      timeUnit: 'DAY',
      datePreset: 'CUSTOM'
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

    const reportJobId = createResponse.data.reportJobId || createResponse.data.id;

    if (!reportJobId) {
      return res.status(500).json({
        success: false,
        error: 'Report Job ID not found in response',
        response: createResponse.data
      });
    }

    // STEP 2: Report Job 상태 확인 및 다운로드
    let attempts = 0;
    const maxAttempts = 10;
    let reportData = null;

    while (attempts < maxAttempts) {
      attempts++;
      
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

        if (status === 'COMPLETE' || status === 'DONE') {
          // 리포트 완성!
          reportData = getResponse.data;
          break;
        } else if (status === 'FAILED' || status === 'ERROR') {
          return res.status(500).json({
            success: false,
            error: 'Report generation failed',
            details: getResponse.data
          });
        }

        // 아직 처리 중이면 2초 대기
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        // 에러 무시하고 재시도
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (!reportData) {
      return res.status(500).json({
        success: false,
        error: 'Report generation timeout',
        attempts: attempts
      });
    }

    // STEP 3: 데이터 파싱
    const campaignStats = [];
    const csvData = reportData.downloadUrl || reportData.data;

    // CSV 다운로드 URL이 있는 경우
    if (reportData.downloadUrl) {
      // CSV 파싱은 클라이언트에서 처리하도록 URL만 반환
      return res.status(200).json({
        success: true,
        period: {
          year: year,
          month: month,
          startDate: startDate,
          endDate: endDate
        },
        reportJobId: reportJobId,
        downloadUrl: reportData.downloadUrl,
        status: reportData.status,
        message: 'Report ready for download'
      });
    }

    // 데이터가 직접 있는 경우
    return res.status(200).json({
      success: true,
      period: {
        year: year,
        month: month,
        startDate: startDate,
        endDate: endDate
      },
      reportJobId: reportJobId,
      data: reportData,
      message: 'Report generated successfully'
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

const axios = require('axios');
const crypto = require('crypto');

// 네이버 광고 API 인증 시그니처 생성
function generateSignature(timestamp, method, uri, secretKey) {
  const message = `${timestamp}.${method}.${uri}`;
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(message)
    .digest('base64');
  return signature;
}

// 날짜 포맷 함수 (YYYY-MM-DD)
function formatDate(year, month) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
  return { startDate, endDate };
}

module.exports = async (req, res) => {
  // CORS 프리플라이트 처리
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

    // 네이버 광고 API 설정
    const BASE_URL = 'https://api.naver.com';
    const API_PATH = '/ncc/stats';
    const timestamp = Date.now().toString();
    const method = 'GET';
    
    const signature = generateSignature(timestamp, method, API_PATH, secretKey);

    // 통계 API 호출
    const statsUrl = `${BASE_URL}${API_PATH}`;
    
    const response = await axios.get(statsUrl, {
      params: {
        ids: customerId,
        timeRange: JSON.stringify({
          since: startDate,
          until: endDate
        }),
        timeIncrement: 1,
        breakdown: 'campaign',
        fields: JSON.stringify([
          'impCnt',
          'clkCnt',
          'salesAmt',
          'ctr',
          'cpc'
        ])
      },
      headers: {
        'X-API-KEY': apiKey,
        'X-Customer': customerId,
        'X-Timestamp': timestamp,
        'X-Signature': signature,
        'Content-Type': 'application/json; charset=UTF-8'
      }
    });

    // 캠페인별 데이터 정리
    const campaignStats = [];
    
    if (response.data && response.data.data) {
      for (const item of response.data.data) {
        campaignStats.push({
          campaignId: item.id || 'unknown',
          campaignName: item.name || 'Unknown Campaign',
          cost: parseInt(item.salesAmt) || 0,
          clicks: parseInt(item.clkCnt) || 0,
          impressions: parseInt(item.impCnt) || 0,
          ctr: parseFloat(item.ctr) || 0,
          cpc: parseInt(item.cpc) || 0
        });
      }
    }

    return res.status(200).json({
      success: true,
      period: {
        year: year,
        month: month,
        startDate: startDate,
        endDate: endDate
      },
      campaigns: campaignStats,
      totalCost: campaignStats.reduce((sum, c) => sum + c.cost, 0),
      totalClicks: campaignStats.reduce((sum, c) => sum + c.clicks, 0),
      totalImpressions: campaignStats.reduce((sum, c) => sum + c.impressions, 0)
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

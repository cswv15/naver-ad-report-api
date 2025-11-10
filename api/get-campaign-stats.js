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

    // StatReports API 호출 (cus- 접두사 제거)
    const response = await axios.get(`${BASE_URL}${API_PATH}`, {
      params: {
        ids: customerId, // cus- 접두사 제거!
        fields: JSON.stringify([
          'impCnt',
          'clkCnt',
          'salesAmt',
          'ctr',
          'cpc',
          'avgRnk',
          'ccnt'
        ]),
        timeRange: JSON.stringify({
          since: startDate,
          until: endDate
        }),
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

    // 응답 데이터 파싱
    let campaignStats = [];
    const rawData = response.data;

    // 데이터 구조 파싱
    if (rawData && Array.isArray(rawData)) {
      for (const item of rawData) {
        if (item.data && Array.isArray(item.data)) {
          // 중첩 구조
          for (const subItem of item.data) {
            campaignStats.push({
              campaignId: subItem.nccCampaignId || subItem.id || 'unknown',
              campaignName: subItem.name || 'Unknown Campaign',
              cost: parseInt(subItem.salesAmt || 0),
              clicks: parseInt(subItem.clkCnt || 0),
              impressions: parseInt(subItem.impCnt || 0),
              conversions: parseInt(subItem.ccnt || 0),
              ctr: parseFloat(subItem.ctr || 0),
              cpc: parseInt(subItem.cpc || 0),
              avgRank: parseFloat(subItem.avgRnk || 0)
            });
          }
        } else {
          // 단일 구조
          campaignStats.push({
            campaignId: item.nccCampaignId || item.id || 'unknown',
            campaignName: item.name || 'Unknown Campaign',
            cost: parseInt(item.salesAmt || 0),
            clicks: parseInt(item.clkCnt || 0),
            impressions: parseInt(item.impCnt || 0),
            conversions: parseInt(item.ccnt || 0),
            ctr: parseFloat(item.ctr || 0),
            cpc: parseInt(item.cpc || 0),
            avgRank: parseFloat(item.avgRnk || 0)
          });
        }
      }
    } else if (rawData && typeof rawData === 'object') {
      // 단일 객체
      campaignStats.push({
        campaignId: rawData.nccCampaignId || rawData.id || 'total',
        campaignName: rawData.name || '전체',
        cost: parseInt(rawData.salesAmt || 0),
        clicks: parseInt(rawData.clkCnt || 0),
        impressions: parseInt(rawData.impCnt || 0),
        conversions: parseInt(rawData.ccnt || 0),
        ctr: parseFloat(rawData.ctr || 0),
        cpc: parseInt(rawData.cpc || 0),
        avgRank: parseFloat(rawData.avgRnk || 0)
      });
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
      totalImpressions: campaignStats.reduce((sum, c) => sum + c.impressions, 0),
      totalConversions: campaignStats.reduce((sum, c) => sum + c.conversions, 0),
      debug: {
        rawDataType: Array.isArray(rawData) ? 'array' : typeof rawData,
        rawDataLength: Array.isArray(rawData) ? rawData.length : 'N/A',
        isEmpty: !rawData || (Array.isArray(rawData) && rawData.length === 0),
        rawData: rawData
      }
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

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

async function getStats(BASE_URL, id, timeRange, apiKey, customerId, secretKey) {
  const timestamp = Date.now().toString();
  
  // Query parameters
  const params = {
    id: id,
    fields: '["impCnt","clkCnt","salesAmt","ctr","cpc","ccnt"]',
    timeRange: JSON.stringify(timeRange)
  };

  // Query string 생성 (서명용)
  const queryString = new URLSearchParams(params).toString();
  const pathWithQuery = `/stats?${queryString}`;
  
  // 서명 생성 (Query string 포함)
  const signature = generateSignature(timestamp, 'GET', pathWithQuery, secretKey);

  try {
    const response = await axios.get(`${BASE_URL}/stats`, {
      params: params,
      headers: {
        'X-API-KEY': apiKey,
        'X-CUSTOMER': customerId,
        'X-TIMESTAMP': timestamp,
        'X-SIGNATURE': signature,
        'Content-Type': 'application/json; charset=UTF-8'
      }
    });

    const data = response.data;
    
    let stats = null;
    if (data.summaryStat && data.summaryStat.data && data.summaryStat.data.length > 0) {
      stats = data.summaryStat.data[0];
    } else if (data.dailyStat && data.dailyStat.summary) {
      stats = data.dailyStat.summary;
    }

    if (stats) {
      return {
        success: true,
        cost: parseInt(stats.salesAmt || 0),
        clicks: parseInt(stats.clkCnt || 0),
        impressions: parseInt(stats.impCnt || 0),
        conversions: parseInt(stats.ccnt || 0),
        ctr: parseFloat(stats.ctr || 0),
        cpc: parseInt(stats.cpc || 0)
      };
    }

    return { 
      success: false,
      reason: 'No stats in response',
      rawData: data,
      cost: 0, clicks: 0, impressions: 0, conversions: 0, ctr: 0, cpc: 0
    };

  } catch (error) {
    return { 
      success: false,
      error: error.response?.data || error.message,
      status: error.response?.status,
      cost: 0, clicks: 0, impressions: 0, conversions: 0, ctr: 0, cpc: 0
    };
  }
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { customerId, apiKey, secretKey, year1, month1, year2, month2 } = req.body;

    if (!customerId || !apiKey || !secretKey || !year1 || !month1 || !year2 || !month2) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: ['customerId', 'apiKey', 'secretKey', 'year1', 'month1', 'year2', 'month2']
      });
    }

    const period1 = formatDate(parseInt(year1), parseInt(month1));
    const period2 = formatDate(parseInt(year2), parseInt(month2));

    const BASE_URL = 'https://api.searchad.naver.com';

    // 캠페인 목록 조회
    const ts1 = Date.now().toString();
    const campaignsPath = '/ncc/campaigns';
    const sig1 = generateSignature(ts1, 'GET', campaignsPath, secretKey);

    const campaignsResponse = await axios.get(`${BASE_URL}${campaignsPath}`, {
      headers: {
        'X-API-KEY': apiKey,
        'X-CUSTOMER': customerId,
        'X-TIMESTAMP': ts1,
        'X-SIGNATURE': sig1,
        'Content-Type': 'application/json; charset=UTF-8'
      }
    });

    const campaigns = campaignsResponse.data;

    // 첫 번째 캠페인 테스트
    const testCampaign = campaigns[0];
    const campaignId = testCampaign.nccCampaignId;

    const stats1 = await getStats(
      BASE_URL,
      campaignId,
      { since: period1.startDate, until: period1.endDate },
      apiKey,
      customerId,
      secretKey
    );

    await new Promise(resolve => setTimeout(resolve, 500));

    const stats2 = await getStats(
      BASE_URL,
      campaignId,
      { since: period2.startDate, until: period2.endDate },
      apiKey,
      customerId,
      secretKey
    );

    return res.status(200).json({
      success: true,
      debug: true,
      period1: { year: year1, month: month1, dateRange: `${period1.startDate} ~ ${period1.endDate}` },
      period2: { year: year2, month: month2, dateRange: `${period2.startDate} ~ ${period2.endDate}` },
      testCampaign: {
        id: campaignId,
        name: testCampaign.name
      },
      stats1Response: stats1,
      stats2Response: stats2,
      message: 'Testing with query string in signature'
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

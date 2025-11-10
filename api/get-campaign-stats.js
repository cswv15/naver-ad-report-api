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

    // 네이버 검색광고 API 설정
    const timestamp = Date.now().toString();
    const method = 'GET';
    
    const results = {
      masterReport: null,
      statReports: null
    };

    // 1. MasterReport API 시도
    try {
      const masterPath = '/ncc/master-report';
      const masterSignature = generateSignature(timestamp, method, masterPath, secretKey);
      
      const masterResponse = await axios.get(`https://api.naver.com${masterPath}`, {
        params: {
          fields: JSON.stringify([
            'impCnt',
            'clkCnt',
            'salesAmt',
            'ctr',
            'cpc'
          ]),
          timeRange: JSON.stringify({
            since: startDate,
            until: endDate
          })
        },
        headers: {
          'X-API-KEY': apiKey,
          'X-Customer': customerId,
          'X-Timestamp': timestamp,
          'X-Signature': masterSignature,
          'Content-Type': 'application/json; charset=UTF-8'
        }
      });
      
      results.masterReport = {
        status: 'SUCCESS',
        data: masterResponse.data
      };
    } catch (error) {
      results.masterReport = {
        status: 'FAILED',
        statusCode: error.response?.status,
        error: error.response?.data || error.message
      };
    }

    // 2. StatReports API 시도
    try {
      const statPath = '/ncc/stat-reports';
      const statSignature = generateSignature(timestamp, method, statPath, secretKey);
      
      const statResponse = await axios.get(`https://api.naver.com${statPath}`, {
        params: {
          ids: `cus-${customerId}`,
          fields: JSON.stringify([
            'impCnt',
            'clkCnt',
            'salesAmt',
            'ctr',
            'cpc'
          ]),
          timeRange: JSON.stringify({
            since: startDate,
            until: endDate
          }),
          breakdown: 'nccCampaignId'
        },
        headers: {
          'X-API-KEY': apiKey,
          'X-Customer': customerId,
          'X-Timestamp': timestamp,
          'X-Signature': statSignature,
          'Content-Type': 'application/json; charset=UTF-8'
        }
      });
      
      results.statReports = {
        status: 'SUCCESS',
        data: statResponse.data
      };
    } catch (error) {
      results.statReports = {
        status: 'FAILED',
        statusCode: error.response?.status,
        error: error.response?.data || error.message
      };
    }

    // 성공한 API가 있으면 데이터 파싱
    let campaignStats = [];
    let source = null;

    if (results.masterReport?.status === 'SUCCESS') {
      source = 'masterReport';
      const data = results.masterReport.data;
      
      // MasterReport는 전체 합산 데이터
      if (data) {
        campaignStats.push({
          campaignId: 'total',
          campaignName: '전체 캠페인',
          cost: parseInt(data.salesAmt || 0),
          clicks: parseInt(data.clkCnt || 0),
          impressions: parseInt(data.impCnt || 0),
          ctr: parseFloat(data.ctr || 0),
          cpc: parseInt(data.cpc || 0)
        });
      }
    }

    if (results.statReports?.status === 'SUCCESS') {
      source = 'statReports';
      const data = results.statReports.data;
      
      // StatReports 파싱
      if (data && Array.isArray(data)) {
        for (const item of data) {
          campaignStats.push({
            campaignId: item.nccCampaignId || item.id || 'unknown',
            campaignName: item.name || 'Unknown Campaign',
            cost: parseInt(item.salesAmt || 0),
            clicks: parseInt(item.clkCnt || 0),
            impressions: parseInt(item.impCnt || 0),
            ctr: parseFloat(item.ctr || 0),
            cpc: parseInt(item.cpc || 0)
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      dataSource: source,
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
      debug: {
        masterReport: results.masterReport,
        statReports: results.statReports
      }
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      details: 'Unknown error occurred'
    });
  }
};

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

async function makeRequest(url, params, headers) {
  try {
    const response = await axios.get(url, { params, headers });
    return { success: true, data: response.data };
  } catch (error) {
    return { 
      success: false, 
      error: error.response?.data || error.message,
      status: error.response?.status
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

    // STEP 1: 캠페인 목록 조회
    const ts1 = Date.now().toString();
    const campaignsPath = '/ncc/campaigns';
    const sig1 = generateSignature(ts1, 'GET', campaignsPath, secretKey);

    const campaignsResult = await makeRequest(
      `${BASE_URL}${campaignsPath}`,
      {},
      {
        'X-API-KEY': apiKey,
        'X-CUSTOMER': customerId,
        'X-TIMESTAMP': ts1,
        'X-SIGNATURE': sig1,
        'Content-Type': 'application/json; charset=UTF-8'
      }
    );

    if (!campaignsResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to get campaigns',
        details: campaignsResult.error
      });
    }

    const campaigns = campaignsResult.data;
    const results = [];

    // STEP 2: 각 캠페인의 AdGroup 조회 및 통계
    for (const campaign of campaigns.slice(0, 3)) { // 처음 3개만 테스트
      const campaignId = campaign.nccCampaignId;

      // AdGroup 목록 조회
      const ts2 = Date.now().toString();
      const adgroupsPath = '/ncc/adgroups';
      const sig2 = generateSignature(ts2, 'GET', adgroupsPath, secretKey);

      const adgroupsResult = await makeRequest(
        `${BASE_URL}${adgroupsPath}`,
        { nccCampaignId: campaignId },
        {
          'X-API-KEY': apiKey,
          'X-CUSTOMER': customerId,
          'X-TIMESTAMP': ts2,
          'X-SIGNATURE': sig2,
          'Content-Type': 'application/json; charset=UTF-8'
        }
      );

      if (!adgroupsResult.success) {
        results.push({
          campaignId: campaignId,
          campaignName: campaign.name,
          error: 'Failed to get adgroups',
          details: adgroupsResult.error
        });
        continue;
      }

      const adgroups = adgroupsResult.data;

      // 각 AdGroup의 통계 조회
      let totalStats1 = { cost: 0, clicks: 0, impressions: 0 };
      let totalStats2 = { cost: 0, clicks: 0, impressions: 0 };

      for (const adgroup of adgroups.slice(0, 5)) { // AdGroup 5개만
        const adgroupId = adgroup.nccAdgroupId;

        // Period 1 통계
        const ts3 = Date.now().toString();
        const statsPath = `/stats`;
        const sig3 = generateSignature(ts3, 'GET', statsPath, secretKey);

        const stats1 = await makeRequest(
          `${BASE_URL}${statsPath}`,
          {
            ids: adgroupId,
            fields: JSON.stringify(['impCnt', 'clkCnt', 'salesAmt']),
            timeRange: JSON.stringify({
              since: period1.startDate,
              until: period1.endDate
            })
          },
          {
            'X-API-KEY': apiKey,
            'X-CUSTOMER': customerId,
            'X-TIMESTAMP': ts3,
            'X-SIGNATURE': sig3,
            'Content-Type': 'application/json; charset=UTF-8'
          }
        );

        if (stats1.success && stats1.data) {
          totalStats1.cost += parseInt(stats1.data.salesAmt || 0);
          totalStats1.clicks += parseInt(stats1.data.clkCnt || 0);
          totalStats1.impressions += parseInt(stats1.data.impCnt || 0);
        }

        // Period 2 통계
        const ts4 = Date.now().toString();
        const sig4 = generateSignature(ts4, 'GET', statsPath, secretKey);

        const stats2 = await makeRequest(
          `${BASE_URL}${statsPath}`,
          {
            ids: adgroupId,
            fields: JSON.stringify(['impCnt', 'clkCnt', 'salesAmt']),
            timeRange: JSON.stringify({
              since: period2.startDate,
              until: period2.endDate
            })
          },
          {
            'X-API-KEY': apiKey,
            'X-CUSTOMER': customerId,
            'X-TIMESTAMP': ts4,
            'X-SIGNATURE': sig4,
            'Content-Type': 'application/json; charset=UTF-8'
          }
        );

        if (stats2.success && stats2.data) {
          totalStats2.cost += parseInt(stats2.data.salesAmt || 0);
          totalStats2.clicks += parseInt(stats2.data.clkCnt || 0);
          totalStats2.impressions += parseInt(stats2.data.impCnt || 0);
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      results.push({
        campaignId: campaignId,
        campaignName: campaign.name,
        adgroupCount: adgroups.length,
        period1: totalStats1,
        period2: totalStats2,
        comparison: {
          costChange: totalStats2.cost - totalStats1.cost,
          clicksChange: totalStats2.clicks - totalStats1.clicks,
          impressionsChange: totalStats2.impressions - totalStats1.impressions
        }
      });
    }

    return res.status(200).json({
      success: true,
      period1: { year: year1, month: month1 },
      period2: { year: year2, month: month2 },
      totalCampaigns: campaigns.length,
      testedCampaigns: results.length,
      campaigns: results,
      message: 'Testing with AdGroup-level stats'
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

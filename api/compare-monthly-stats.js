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

function calculateChange(oldVal, newVal) {
  if (oldVal === 0) return newVal > 0 ? 100 : 0;
  return ((newVal - oldVal) / oldVal * 100).toFixed(2);
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
    const timestamp = Date.now().toString();

    // STEP 1: 캠페인 목록 조회
    const campaignsPath = '/ncc/campaigns';
    const campaignsSignature = generateSignature(timestamp, 'GET', campaignsPath, secretKey);

    const campaignsResponse = await axios.get(`${BASE_URL}${campaignsPath}`, {
      headers: {
        'X-API-KEY': apiKey,
        'X-CUSTOMER': customerId,
        'X-TIMESTAMP': timestamp,
        'X-SIGNATURE': campaignsSignature,
        'Content-Type': 'application/json; charset=UTF-8'
      }
    });

    const campaigns = campaignsResponse.data;

    // STEP 2: 각 캠페인의 2개월 통계 비교
    const comparisonResults = [];

    for (const campaign of campaigns) {
      const campaignId = campaign.nccCampaignId;
      
      // 첫 번째 월 통계
      let stats1 = null;
      try {
        const ts1 = Date.now().toString();
        const statsPath = `/stats`;
        const sig1 = generateSignature(ts1, 'GET', statsPath, secretKey);

        const response1 = await axios.get(`${BASE_URL}${statsPath}`, {
          params: {
            ids: campaignId,
            fields: JSON.stringify(['impCnt', 'clkCnt', 'salesAmt', 'ctr', 'cpc', 'ccnt']),
            timeRange: JSON.stringify({
              since: period1.startDate,
              until: period1.endDate
            })
          },
          headers: {
            'X-API-KEY': apiKey,
            'X-CUSTOMER': customerId,
            'X-TIMESTAMP': ts1,
            'X-SIGNATURE': sig1,
            'Content-Type': 'application/json; charset=UTF-8'
          }
        });
        stats1 = response1.data;
      } catch (error) {
        stats1 = { error: error.response?.data || error.message };
      }

      // 두 번째 월 통계
      let stats2 = null;
      try {
        const ts2 = Date.now().toString();
        const statsPath = `/stats`;
        const sig2 = generateSignature(ts2, 'GET', statsPath, secretKey);

        const response2 = await axios.get(`${BASE_URL}${statsPath}`, {
          params: {
            ids: campaignId,
            fields: JSON.stringify(['impCnt', 'clkCnt', 'salesAmt', 'ctr', 'cpc', 'ccnt']),
            timeRange: JSON.stringify({
              since: period2.startDate,
              until: period2.endDate
            })
          },
          headers: {
            'X-API-KEY': apiKey,
            'X-CUSTOMER': customerId,
            'X-TIMESTAMP': ts2,
            'X-SIGNATURE': sig2,
            'Content-Type': 'application/json; charset=UTF-8'
          }
        });
        stats2 = response2.data;
      } catch (error) {
        stats2 = { error: error.response?.data || error.message };
      }

      // 비교 데이터 생성
      if (stats1 && stats2 && !stats1.error && !stats2.error) {
        const cost1 = parseInt(stats1.salesAmt || 0);
        const cost2 = parseInt(stats2.salesAmt || 0);
        const clicks1 = parseInt(stats1.clkCnt || 0);
        const clicks2 = parseInt(stats2.clkCnt || 0);
        const impressions1 = parseInt(stats1.impCnt || 0);
        const impressions2 = parseInt(stats2.impCnt || 0);
        const conversions1 = parseInt(stats1.ccnt || 0);
        const conversions2 = parseInt(stats2.ccnt || 0);

        comparisonResults.push({
          campaignId: campaignId,
          campaignName: campaign.name,
          period1: {
            year: year1,
            month: month1,
            cost: cost1,
            clicks: clicks1,
            impressions: impressions1,
            conversions: conversions1,
            ctr: parseFloat(stats1.ctr || 0),
            cpc: parseInt(stats1.cpc || 0)
          },
          period2: {
            year: year2,
            month: month2,
            cost: cost2,
            clicks: clicks2,
            impressions: impressions2,
            conversions: conversions2,
            ctr: parseFloat(stats2.ctr || 0),
            cpc: parseInt(stats2.cpc || 0)
          },
          comparison: {
            costChange: cost2 - cost1,
            costChangePercent: calculateChange(cost1, cost2),
            clicksChange: clicks2 - clicks1,
            clicksChangePercent: calculateChange(clicks1, clicks2),
            impressionsChange: impressions2 - impressions1,
            impressionsChangePercent: calculateChange(impressions1, impressions2),
            conversionsChange: conversions2 - conversions1,
            conversionsChangePercent: calculateChange(conversions1, conversions2)
          }
        });
      } else {
        comparisonResults.push({
          campaignId: campaignId,
          campaignName: campaign.name,
          error: 'Failed to retrieve stats for one or both periods',
          stats1: stats1,
          stats2: stats2
        });
      }

      // API 호출 간격 (Rate limit 방지)
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // 전체 합계
    const totalPeriod1 = comparisonResults.reduce((sum, c) => ({
      cost: sum.cost + (c.period1?.cost || 0),
      clicks: sum.clicks + (c.period1?.clicks || 0),
      impressions: sum.impressions + (c.period1?.impressions || 0),
      conversions: sum.conversions + (c.period1?.conversions || 0)
    }), { cost: 0, clicks: 0, impressions: 0, conversions: 0 });

    const totalPeriod2 = comparisonResults.reduce((sum, c) => ({
      cost: sum.cost + (c.period2?.cost || 0),
      clicks: sum.clicks + (c.period2?.clicks || 0),
      impressions: sum.impressions + (c.period2?.impressions || 0),
      conversions: sum.conversions + (c.period2?.conversions || 0)
    }), { cost: 0, clicks: 0, impressions: 0, conversions: 0 });

    return res.status(200).json({
      success: true,
      period1: {
        year: year1,
        month: month1,
        dateRange: `${period1.startDate} ~ ${period1.endDate}`
      },
      period2: {
        year: year2,
        month: month2,
        dateRange: `${period2.startDate} ~ ${period2.endDate}`
      },
      totalCampaigns: campaigns.length,
      campaigns: comparisonResults,
      totals: {
        period1: totalPeriod1,
        period2: totalPeriod2,
        comparison: {
          costChange: totalPeriod2.cost - totalPeriod1.cost,
          costChangePercent: calculateChange(totalPeriod1.cost, totalPeriod2.cost),
          clicksChange: totalPeriod2.clicks - totalPeriod1.clicks,
          clicksChangePercent: calculateChange(totalPeriod1.clicks, totalPeriod2.clicks),
          impressionsChange: totalPeriod2.impressions - totalPeriod1.impressions,
          impressionsChangePercent: calculateChange(totalPeriod1.impressions, totalPeriod2.impressions)
        }
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

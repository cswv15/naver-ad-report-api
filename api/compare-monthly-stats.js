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

async function getStats(BASE_URL, id, timeRange, apiKey, customerId, secretKey) {
  const timestamp = Date.now().toString();
  const path = '/stats';
  const signature = generateSignature(timestamp, 'GET', path, secretKey);

  const params = {
    id: id,
    fields: '["impCnt","clkCnt","salesAmt","ctr","cpc","ccnt"]',
    timeRange: JSON.stringify(timeRange)
  };

  try {
    const response = await axios.get(`${BASE_URL}${path}`, {
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
    
    // data 배열에서 일별 데이터 합산
    if (data.data && Array.isArray(data.data) && data.data.length > 0) {
      const totals = data.data.reduce((sum, day) => ({
        salesAmt: sum.salesAmt + (day.salesAmt || 0),
        clkCnt: sum.clkCnt + (day.clkCnt || 0),
        impCnt: sum.impCnt + (day.impCnt || 0),
        ccnt: sum.ccnt + (day.ccnt || 0)
      }), { salesAmt: 0, clkCnt: 0, impCnt: 0, ccnt: 0 });

      const avgCtr = data.data.reduce((sum, day) => sum + (day.ctr || 0), 0) / data.data.length;
      const avgCpc = totals.clkCnt > 0 ? Math.round(totals.salesAmt / totals.clkCnt) : 0;

      return {
        success: true,
        cost: totals.salesAmt,
        clicks: totals.clkCnt,
        impressions: totals.impCnt,
        conversions: totals.ccnt,
        ctr: parseFloat(avgCtr.toFixed(2)),
        cpc: avgCpc
      };
    }

    // summaryStat 방식 (fallback)
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
    const results = [];

    // 모든 캠페인 조회
    for (const campaign of campaigns) {
      const campaignId = campaign.nccCampaignId;

      const stats1 = await getStats(
        BASE_URL,
        campaignId,
        { since: period1.startDate, until: period1.endDate },
        apiKey,
        customerId,
        secretKey
      );

      await new Promise(resolve => setTimeout(resolve, 100));

      const stats2 = await getStats(
        BASE_URL,
        campaignId,
        { since: period2.startDate, until: period2.endDate },
        apiKey,
        customerId,
        secretKey
      );

      results.push({
        campaignId: campaignId,
        campaignName: campaign.name,
        period1: {
          year: year1,
          month: month1,
          cost: stats1.cost,
          clicks: stats1.clicks,
          impressions: stats1.impressions,
          conversions: stats1.conversions,
          ctr: stats1.ctr,
          cpc: stats1.cpc
        },
        period2: {
          year: year2,
          month: month2,
          cost: stats2.cost,
          clicks: stats2.clicks,
          impressions: stats2.impressions,
          conversions: stats2.conversions,
          ctr: stats2.ctr,
          cpc: stats2.cpc
        },
        comparison: {
          costChange: stats2.cost - stats1.cost,
          costChangePercent: calculateChange(stats1.cost, stats2.cost),
          clicksChange: stats2.clicks - stats1.clicks,
          clicksChangePercent: calculateChange(stats1.clicks, stats2.clicks),
          impressionsChange: stats2.impressions - stats1.impressions,
          impressionsChangePercent: calculateChange(stats1.impressions, stats2.impressions),
          conversionsChange: stats2.conversions - stats1.conversions,
          conversionsChangePercent: calculateChange(stats1.conversions, stats2.conversions)
        }
      });

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // 전체 합계
    const totalPeriod1 = results.reduce((sum, c) => ({
      cost: sum.cost + c.period1.cost,
      clicks: sum.clicks + c.period1.clicks,
      impressions: sum.impressions + c.period1.impressions,
      conversions: sum.conversions + c.period1.conversions
    }), { cost: 0, clicks: 0, impressions: 0, conversions: 0 });

    const totalPeriod2 = results.reduce((sum, c) => ({
      cost: sum.cost + c.period2.cost,
      clicks: sum.clicks + c.period2.clicks,
      impressions: sum.impressions + c.period2.impressions,
      conversions: sum.conversions + c.period2.conversions
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
      campaigns: results,
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

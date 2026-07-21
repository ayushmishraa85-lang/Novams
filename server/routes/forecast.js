const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Simple linear regression y = a + b*x, x = month index
function linearRegression(values) {
  const n = values.length;
  if (n === 0) return { a: 0, b: 0 };
  if (n === 1) return { a: values[0], b: 0 };

  const xs = values.map((_, i) => i);
  const sumX = xs.reduce((s, x) => s + x, 0);
  const sumY = values.reduce((s, y) => s + y, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * values[i], 0);
  const sumXX = xs.reduce((s, x) => s + x * x, 0);

  const denom = n * sumXX - sumX * sumX;
  const b = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const a = (sumY - b * sumX) / n;
  return { a, b };
}

router.get('/', async (req, res) => {
  try {
    const userId = req.dataOwnerId;

    const monthly = await pool.query(
      `SELECT date_trunc('month', sale_date) AS month_sort,
              COALESCE(SUM(quantity),0) AS sales,
              COALESCE(SUM(revenue),0) AS revenue
       FROM sales WHERE user_id = $1
       GROUP BY 1 ORDER BY 1`,
      [userId]
    );

    const rows = monthly.rows;
    const salesSeries = rows.map(r => Number(r.sales));
    const revenueSeries = rows.map(r => Number(r.revenue));

    const salesFit = linearRegression(salesSeries);
    const revenueFit = linearRegression(revenueSeries);

    // Confidence is a rough heuristic: more historical months = higher confidence, capped 60-95%
    const monthsOfData = rows.length;
    const baseConfidence = Math.min(95, 60 + monthsOfData * 3);

    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const startIdx = rows.length > 0 ? new Date(rows[rows.length - 1].month_sort).getMonth() : new Date().getMonth();

    const forecast = [];
    for (let i = 1; i <= 6; i++) {
      const x = salesSeries.length - 1 + i;
      const predictedSales = Math.max(0, Math.round(salesFit.a + salesFit.b * x));
      const predictedRevenue = Math.max(0, revenueFit.a + revenueFit.b * x);
      const monthLabel = monthNames[(startIdx + i) % 12];
      const confidence = Math.max(50, baseConfidence - i * 3); // confidence decays further out
      forecast.push({
        month: monthLabel,
        predictedSales,
        predictedRevenue: Math.round(predictedRevenue * 100) / 100,
        confidence
      });
    }

    res.json({
      hasEnoughData: monthsOfData >= 2,
      forecast
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate forecast.' });
  }
});

module.exports = router;

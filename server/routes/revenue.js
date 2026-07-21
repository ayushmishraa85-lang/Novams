const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const userId = req.dataOwnerId;

    const totalRes = await pool.query(
      'SELECT COALESCE(SUM(revenue),0) AS revenue FROM sales WHERE user_id = $1',
      [userId]
    );

    const thisMonth = await pool.query(
      `SELECT COALESCE(SUM(revenue),0) AS revenue FROM sales
       WHERE user_id = $1 AND date_trunc('month', sale_date) = date_trunc('month', CURRENT_DATE)`,
      [userId]
    );
    const lastMonth = await pool.query(
      `SELECT COALESCE(SUM(revenue),0) AS revenue FROM sales
       WHERE user_id = $1 AND date_trunc('month', sale_date) = date_trunc('month', CURRENT_DATE - INTERVAL '1 month')`,
      [userId]
    );

    const monthly = await pool.query(
      `SELECT to_char(date_trunc('month', sale_date), 'Mon') AS month,
              date_trunc('month', sale_date) AS month_sort,
              COALESCE(SUM(revenue),0) AS revenue
       FROM sales WHERE user_id = $1
       GROUP BY 1, 2 ORDER BY 2`,
      [userId]
    );

    const tm = Number(thisMonth.rows[0].revenue);
    const lm = Number(lastMonth.rows[0].revenue);
    const growth = lm > 0 ? ((tm - lm) / lm) * 100 : (tm > 0 ? 100 : 0);

    res.json({
      totalRevenue: Number(totalRes.rows[0].revenue),
      growthRate: growth,
      monthlyRevenue: monthly.rows.map(r => ({ month: r.month, revenue: Number(r.revenue) }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load revenue analytics.' });
  }
});

module.exports = router;

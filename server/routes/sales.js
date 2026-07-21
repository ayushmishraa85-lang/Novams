const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const userId = req.dataOwnerId;

    const trend = await pool.query(
      `SELECT to_char(date_trunc('month', sale_date), 'Mon') AS month,
              date_trunc('month', sale_date) AS month_sort,
              COALESCE(SUM(quantity),0) AS sales,
              COALESCE(SUM(revenue),0) AS revenue,
              COALESCE(SUM(orders),0) AS orders
       FROM sales WHERE user_id = $1
       GROUP BY 1, 2 ORDER BY 2`,
      [userId]
    );

    const recentTransactions = await pool.query(
      `SELECT to_char(sale_date,'YYYY-MM-DD') AS date, product_name, category, quantity, revenue, customer_name, city
       FROM sales WHERE user_id = $1
       ORDER BY sale_date DESC, id DESC LIMIT 15`,
      [userId]
    );

    const weekendSplit = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM sale_date) IN (0,6) THEN revenue ELSE 0 END),0) AS weekend_revenue,
         COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM sale_date) NOT IN (0,6) THEN revenue ELSE 0 END),0) AS weekday_revenue
       FROM sales WHERE user_id = $1`,
      [userId]
    );

    const avgBasket = await pool.query(
      `SELECT COALESCE(SUM(quantity),0) AS qty, COALESCE(SUM(orders),0) AS orders FROM sales WHERE user_id = $1`,
      [userId]
    );
    const totalOrdersForBasket = Number(avgBasket.rows[0].orders);

    res.json({
      trend: trend.rows.map(r => ({ month: r.month, sales: Number(r.sales) })),
      monthlyBreakdown: trend.rows.map(r => ({
        month: r.month,
        sales: Number(r.sales),
        revenue: Number(r.revenue),
        orders: Number(r.orders)
      })),
      recentTransactions: recentTransactions.rows.map(r => ({
        date: r.date, product: r.product_name, category: r.category, quantity: Number(r.quantity),
        revenue: Number(r.revenue), customer: r.customer_name, city: r.city
      })),
      weekendVsWeekday: {
        weekend: Number(weekendSplit.rows[0].weekend_revenue),
        weekday: Number(weekendSplit.rows[0].weekday_revenue)
      },
      avgBasketSize: totalOrdersForBasket > 0 ? Number(avgBasket.rows[0].qty) / totalOrdersForBasket : 0
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load sales analytics.' });
  }
});

module.exports = router;

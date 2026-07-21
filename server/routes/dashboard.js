const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function pctChange(current, previous) {
  if (!previous || previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

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

// Executive Overview: ONLY the top-line numbers + the specific charts requested.
// Detailed tables, full customer/employee/inventory data live in their own modules.
router.get('/summary', async (req, res) => {
  try {
    const userId = req.dataOwnerId;

    const marginRow = await pool.query('SELECT default_margin_percent FROM users WHERE id = $1', [userId]);
    const assumedMargin = Number(marginRow.rows[0]?.default_margin_percent ?? 25);

    // Real cost data takes priority; rows without a cost fall back to the assumed margin.
    const profitExpr = `(revenue - COALESCE(cost, revenue * (1 - ${assumedMargin} / 100.0)))`;

    const totals = await pool.query(
      `SELECT COALESCE(SUM(revenue),0) AS revenue, COALESCE(SUM(orders),0) AS orders,
              COALESCE(SUM(${profitExpr}),0) AS profit,
              COUNT(*) FILTER (WHERE cost IS NOT NULL) AS rows_with_real_cost,
              COUNT(*) AS total_rows
       FROM sales WHERE user_id = $1`,
      [userId]
    );
    const t = totals.rows[0];
    const totalRevenue = Number(t.revenue);
    const totalOrders = Number(t.orders);
    const totalProfit = Number(t.profit);
    const profitMarginPct = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const rowsWithRealCost = Number(t.rows_with_real_cost);
    const totalRows = Number(t.total_rows);
    const profitBasis = totalRows === 0 ? 'none' : rowsWithRealCost === totalRows ? 'actual' : rowsWithRealCost === 0 ? 'estimated' : 'partial';

    const now = new Date();
    const thisKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastKey = `${lastDate.getFullYear()}-${String(lastDate.getMonth() + 1).padStart(2, '0')}`;
    const thisMonth = await pool.query(
      `SELECT COALESCE(SUM(revenue),0) AS revenue FROM sales WHERE user_id = $1 AND date_trunc('month', sale_date) = date_trunc('month', CURRENT_DATE)`,
      [userId]
    );
    const lastMonth = await pool.query(
      `SELECT COALESCE(SUM(revenue),0) AS revenue FROM sales WHERE user_id = $1 AND date_trunc('month', sale_date) = date_trunc('month', CURRENT_DATE - INTERVAL '1 month')`,
      [userId]
    );
    const revenueChangePct = pctChange(Number(thisMonth.rows[0].revenue), Number(lastMonth.rows[0].revenue));

    // Revenue Trend
    const revenueTrend = await pool.query(
      `SELECT to_char(date_trunc('month', sale_date), 'Mon') AS month, date_trunc('month', sale_date) AS month_sort,
              COALESCE(SUM(revenue),0) AS revenue
       FROM sales WHERE user_id = $1 GROUP BY 1, 2 ORDER BY 2`,
      [userId]
    );

    // AI Sales Forecast (next month prediction, shown as a headline stat)
    const monthlyRevenueSeries = revenueTrend.rows.map(r => Number(r.revenue));
    const fit = linearRegression(monthlyRevenueSeries);
    const nextMonthForecast = monthlyRevenueSeries.length >= 2
      ? Math.max(0, fit.a + fit.b * monthlyRevenueSeries.length)
      : null;

    // Revenue by Category
    const categoryBreakdown = await pool.query(
      `SELECT COALESCE(category, 'Uncategorized') AS category, COALESCE(SUM(revenue),0) AS revenue
       FROM sales WHERE user_id = $1 GROUP BY category ORDER BY revenue DESC LIMIT 8`,
      [userId]
    );

    // Revenue by City (optional field - only populated if the uploaded CSV included a city column)
    const cityBreakdown = await pool.query(
      `SELECT city, COALESCE(SUM(revenue),0) AS revenue
       FROM sales WHERE user_id = $1 AND city IS NOT NULL AND city != ''
       GROUP BY city ORDER BY revenue DESC LIMIT 10`,
      [userId]
    );

    // Top 10 Products
    const topProducts = await pool.query(
      `SELECT product_name, COALESCE(SUM(revenue),0) AS revenue
       FROM sales WHERE user_id = $1 GROUP BY product_name ORDER BY revenue DESC LIMIT 10`,
      [userId]
    );

    // Profit Margin by Category
    const marginByCategory = await pool.query(
      `SELECT COALESCE(category, 'Uncategorized') AS category,
              COALESCE(SUM(revenue),0) AS revenue,
              COALESCE(SUM(${profitExpr}),0) AS profit
       FROM sales WHERE user_id = $1 GROUP BY category ORDER BY revenue DESC LIMIT 8`,
      [userId]
    );

    // Condensed AI Insights (top 3 only - full list lives in AI Business Insights module)
    const insights = [];
    const lowStock = await pool.query(
      `SELECT COUNT(*) AS count FROM products WHERE user_id = $1 AND (stock < 10 OR out_of_stock = true)`, [userId]
    );
    if (Number(lowStock.rows[0].count) > 0) {
      insights.push({
        title: 'Restock Needed',
        description: `${lowStock.rows[0].count} SKU(s) are low or out of stock. Reorder soon to avoid missed sales.`,
        priority: 'High'
      });
    }
    if (categoryBreakdown.rows.length > 0) {
      const top = categoryBreakdown.rows[0];
      insights.push({
        title: `${top.category} Leads Revenue`,
        description: `${top.category} is your top-earning category at ${Number(top.revenue).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}. Consider prioritizing its assortment and stock levels.`,
        priority: 'Medium'
      });
    }
    if (nextMonthForecast !== null && monthlyRevenueSeries.length > 0) {
      const lastActual = monthlyRevenueSeries[monthlyRevenueSeries.length - 1];
      const change = pctChange(nextMonthForecast, lastActual);
      insights.push({
        title: change >= 0 ? 'Revenue Expected to Grow' : 'Revenue May Slow Down',
        description: `AI forecast projects next month's revenue to ${change >= 0 ? 'increase' : 'decrease'} by about ${Math.abs(change).toFixed(0)}% based on recent trends.`,
        priority: 'Medium'
      });
    }

    res.json({
      totalRevenue,
      totalProfit,
      totalOrders,
      profitMarginPct,
      profitBasis,
      assumedMargin,
      nextMonthForecast,
      revenueChangePct,
      revenueTrend: revenueTrend.rows.map(r => ({ month: r.month, revenue: Number(r.revenue) })),
      categoryBreakdown: categoryBreakdown.rows.map(r => ({ category: r.category, revenue: Number(r.revenue) })),
      cityBreakdown: cityBreakdown.rows.map(r => ({ city: r.city, revenue: Number(r.revenue) })),
      topProducts: topProducts.rows.map(r => ({ name: r.product_name, revenue: Number(r.revenue) })),
      marginByCategory: marginByCategory.rows.map(r => ({
        category: r.category,
        marginPct: Number(r.revenue) > 0 ? (Number(r.profit) / Number(r.revenue)) * 100 : 0
      })),
      insights
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load dashboard summary.' });
  }
});

module.exports = router;

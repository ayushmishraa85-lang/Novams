const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const userId = req.dataOwnerId;
    const insights = [];

    // 1. Category trending up
    const catThis = await pool.query(
      `SELECT category, COALESCE(SUM(revenue),0) AS revenue FROM sales
       WHERE user_id = $1 AND date_trunc('month', sale_date) = date_trunc('month', CURRENT_DATE) AND category IS NOT NULL
       GROUP BY category`,
      [userId]
    );
    const catLast = await pool.query(
      `SELECT category, COALESCE(SUM(revenue),0) AS revenue FROM sales
       WHERE user_id = $1 AND date_trunc('month', sale_date) = date_trunc('month', CURRENT_DATE - INTERVAL '1 month') AND category IS NOT NULL
       GROUP BY category`,
      [userId]
    );
    const lastMap = Object.fromEntries(catLast.rows.map(r => [r.category, Number(r.revenue)]));
    let bestCat = null, bestGrowth = 0;
    for (const row of catThis.rows) {
      const prev = lastMap[row.category] || 0;
      const cur = Number(row.revenue);
      const growth = prev > 0 ? ((cur - prev) / prev) * 100 : (cur > 0 ? 100 : 0);
      if (growth > bestGrowth) { bestGrowth = growth; bestCat = row.category; }
    }
    if (bestCat && bestGrowth > 5) {
      insights.push({
        type: 'trend',
        title: `${bestCat} Category Trending Up`,
        description: `${bestCat} sales increased ${bestGrowth.toFixed(0)}% this month. Consider expanding inventory.`,
        priority: bestGrowth > 20 ? 'High' : 'Medium',
        impact: bestGrowth > 20 ? 'High' : 'Medium'
      });
    }

    // 2. Low stock / out of stock alert
    const lowStock = await pool.query(
      'SELECT COUNT(*) AS count FROM products WHERE user_id = $1 AND (stock < 10 OR out_of_stock = true)',
      [userId]
    );
    const lowStockCount = Number(lowStock.rows[0].count);
    if (lowStockCount > 0) {
      insights.push({
        type: 'alert',
        title: 'Low Stock Alert',
        description: `${lowStockCount} product${lowStockCount === 1 ? '' : 's'} ${lowStockCount === 1 ? 'is' : 'are'} running low or out of stock and may need reordering.`,
        priority: 'High',
        impact: 'Medium'
      });
    }

    // 3. Weekend sales peak
    const weekend = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM sale_date) IN (0,6) THEN revenue ELSE 0 END),0) AS weekend_rev,
         COALESCE(SUM(revenue),0) AS total_rev
       FROM sales WHERE user_id = $1`,
      [userId]
    );
    const wr = Number(weekend.rows[0].weekend_rev);
    const tr = Number(weekend.rows[0].total_rev);
    if (tr > 0) {
      const pct = (wr / tr) * 100;
      if (pct > 35) {
        insights.push({
          type: 'trend',
          title: 'Weekend Sales Peak',
          description: `${pct.toFixed(0)}% of sales occur on weekends. Optimize staffing and promotions.`,
          priority: 'Medium',
          impact: 'Medium'
        });
      }
    }

    // 4. VIP customer growth
    const vip = await pool.query(
      `SELECT COUNT(*) AS vip_count, COALESCE(AVG(total_spent),0) AS vip_avg FROM customers WHERE user_id = $1 AND is_vip = true`,
      [userId]
    );
    const allAvg = await pool.query(
      `SELECT COALESCE(AVG(total_spent),0) AS avg_spent FROM customers WHERE user_id = $1`,
      [userId]
    );
    const vipCount = Number(vip.rows[0].vip_count);
    const vipAvg = Number(vip.rows[0].vip_avg);
    const overallAvg = Number(allAvg.rows[0].avg_spent);
    if (vipCount > 0 && overallAvg > 0) {
      const multiplier = vipAvg / overallAvg;
      insights.push({
        type: 'trend',
        title: 'VIP Customer Growth',
        description: `VIP customers spending ${multiplier.toFixed(1)}x more than average. Focus on retention programs.`,
        priority: 'High',
        impact: 'High'
      });
    }

    // 5. Deepest average discount by category (catalog-driven insight)
    const discountByCat = await pool.query(
      `SELECT category, AVG(discount_percent) AS avg_discount, COUNT(*) AS product_count
       FROM products WHERE user_id = $1 AND discount_percent IS NOT NULL AND category IS NOT NULL
       GROUP BY category HAVING COUNT(*) >= 3 ORDER BY avg_discount DESC LIMIT 1`,
      [userId]
    );
    if (discountByCat.rows.length > 0) {
      const row = discountByCat.rows[0];
      const avgDiscount = Number(row.avg_discount);
      if (avgDiscount > 10) {
        insights.push({
          type: 'trend',
          title: `${row.category} Has the Deepest Discounts`,
          description: `${row.category} products are discounted ${avgDiscount.toFixed(0)}% on average across ${row.product_count} items — a strong promotional lever if margins allow.`,
          priority: 'Medium',
          impact: 'Medium'
        });
      }
    }

    // 6. Perishable stock risk (quick commerce: fruits/veg/dairy/meat spoil fast if not turned over)
    const perishable = await pool.query(
      `SELECT COUNT(*) AS count FROM products
       WHERE user_id = $1 AND stock > 0
       AND category ILIKE ANY(ARRAY['%fruit%', '%vegetable%', '%dairy%', '%meat%', '%fish%', '%egg%', '%bakery%', '%batter%'])`,
      [userId]
    );
    const perishableCount = Number(perishable.rows[0].count);
    if (perishableCount > 0) {
      insights.push({
        type: 'alert',
        title: 'Perishable Stock Needs Fast Turnover',
        description: `${perishableCount} perishable item${perishableCount === 1 ? '' : 's'} in stock (fruits, vegetables, dairy, meat). Prioritize quick rotation to avoid spoilage losses.`,
        priority: 'High',
        impact: 'High'
      });
    }

    // 7. Repeat customer / retention rate - a core quick-commerce health metric
    const repeatStats = await pool.query(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE orders_count > 1) AS repeat_count FROM customers WHERE user_id = $1`,
      [userId]
    );
    const totalCust = Number(repeatStats.rows[0].total);
    const repeatCust = Number(repeatStats.rows[0].repeat_count);
    if (totalCust >= 3) {
      const repeatRate = (repeatCust / totalCust) * 100;
      insights.push({
        type: repeatRate < 30 ? 'alert' : 'trend',
        title: 'Repeat Order Rate',
        description: `${repeatRate.toFixed(0)}% of customers have ordered more than once. ${repeatRate < 30 ? 'Low repeat rate for quick commerce — consider loyalty perks or faster reorder flows.' : 'Healthy repeat-order behavior for a quick-commerce business.'}`,
        priority: repeatRate < 30 ? 'High' : 'Medium',
        impact: 'High'
      });
    }

    // 8. Small basket size flag (quick commerce thrives on frequent small orders, but too small hurts unit economics)
    const basketStats = await pool.query(
      `SELECT COALESCE(SUM(quantity),0) AS qty, COALESCE(SUM(orders),0) AS orders FROM sales WHERE user_id = $1`,
      [userId]
    );
    const totalOrdersForBasket = Number(basketStats.rows[0].orders);
    if (totalOrdersForBasket > 0) {
      const avgBasket = Number(basketStats.rows[0].qty) / totalOrdersForBasket;
      if (avgBasket < 2) {
        insights.push({
          type: 'alert',
          title: 'Small Basket Size',
          description: `Average basket size is ${avgBasket.toFixed(1)} items per order. Consider bundle deals or free-delivery thresholds to raise order value and improve delivery unit economics.`,
          priority: 'Medium',
          impact: 'Medium'
        });
      }
    }

    if (insights.length === 0) {
      insights.push({
        type: 'info',
        title: 'Not Enough Data Yet',
        description: 'Upload sales data to start generating AI-powered insights about your business.',
        priority: 'Medium',
        impact: 'Medium'
      });
    }

    res.json({ insights });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate insights.' });
  }
});

module.exports = router;

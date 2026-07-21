const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function toCSV(rows, columns) {
  const header = columns.join(',');
  const lines = rows.map(row =>
    columns.map(col => {
      const val = row[col] === null || row[col] === undefined ? '' : String(row[col]);
      return /[,"\n]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val;
    }).join(',')
  );
  return [header, ...lines].join('\n');
}

const REPORT_TYPES = {
  'monthly-sales': {
    name: 'Monthly Sales Report',
    description: 'Comprehensive sales analysis for the current month',
    async query(userId) {
      const r = await pool.query(
        `SELECT to_char(sale_date,'YYYY-MM-DD') AS date, product_name, category, quantity, revenue, orders
         FROM sales WHERE user_id = $1 AND date_trunc('month', sale_date) = date_trunc('month', CURRENT_DATE)
         ORDER BY sale_date`,
        [userId]
      );
      return toCSV(r.rows, ['date', 'product_name', 'category', 'quantity', 'revenue', 'orders']);
    }
  },
  'customer-analytics': {
    name: 'Customer Analytics',
    description: 'Detailed customer behavior and segmentation report',
    async query(userId) {
      const r = await pool.query(
        `SELECT name, email, total_spent, orders_count, is_vip FROM customers WHERE user_id = $1 ORDER BY total_spent DESC`,
        [userId]
      );
      return toCSV(r.rows, ['name', 'email', 'total_spent', 'orders_count', 'is_vip']);
    }
  },
  'product-performance': {
    name: 'Product Performance',
    description: 'Product-wise sales and inventory analysis',
    async query(userId) {
      const r = await pool.query(
        `SELECT name, category, price, stock, units_sold FROM products WHERE user_id = $1 ORDER BY units_sold DESC`,
        [userId]
      );
      return toCSV(r.rows, ['name', 'category', 'price', 'stock', 'units_sold']);
    }
  },
  'revenue-breakdown': {
    name: 'Revenue Breakdown',
    description: 'Revenue analysis by category and region',
    async query(userId) {
      const r = await pool.query(
        `SELECT category, COALESCE(SUM(revenue),0) AS total_revenue, COALESCE(SUM(quantity),0) AS units
         FROM sales WHERE user_id = $1 GROUP BY category ORDER BY total_revenue DESC`,
        [userId]
      );
      return toCSV(r.rows, ['category', 'total_revenue', 'units']);
    }
  },
  'category-assortment': {
    name: 'Category Assortment (Quick Commerce)',
    description: 'SKU count, stock health, and discount depth per category for dark-store planning',
    async query(userId) {
      const r = await pool.query(
        `SELECT category, COUNT(*) AS sku_count,
                COUNT(*) FILTER (WHERE stock < 10 OR out_of_stock = true) AS low_stock_skus,
                ROUND(AVG(discount_percent)::numeric, 1) AS avg_discount_percent,
                ROUND(AVG(stock)::numeric, 1) AS avg_stock
         FROM products WHERE user_id = $1
         GROUP BY category ORDER BY sku_count DESC`,
        [userId]
      );
      return toCSV(r.rows, ['category', 'sku_count', 'low_stock_skus', 'avg_discount_percent', 'avg_stock']);
    }
  },
  'fast-slow-movers': {
    name: 'Fast vs Slow Moving SKUs',
    description: 'Product velocity ranking to guide dark-store restocking priority',
    async query(userId) {
      const r = await pool.query(
        `SELECT name, category, units_sold, stock,
                CASE WHEN units_sold >= (SELECT COALESCE(AVG(units_sold),0) FROM products WHERE user_id = $1)
                     THEN 'Fast Moving' ELSE 'Slow Moving' END AS velocity
         FROM products WHERE user_id = $1 ORDER BY units_sold DESC`,
        [userId]
      );
      return toCSV(r.rows, ['name', 'category', 'units_sold', 'stock', 'velocity']);
    }
  }
};

router.get('/', async (req, res) => {
  const list = Object.entries(REPORT_TYPES).map(([id, r]) => ({
    id, name: r.name, description: r.description, format: 'CSV'
  }));
  res.json({ reports: list });
});

router.get('/:id/download', async (req, res) => {
  try {
    const report = REPORT_TYPES[req.params.id];
    if (!report) return res.status(404).json({ error: 'Unknown report type.' });

    const csv = await report.query(req.dataOwnerId);

    const userRow = await pool.query('SELECT name FROM users WHERE id = $1', [req.userId]);
    await pool.query(
      'INSERT INTO report_downloads (user_id, downloaded_by, report_id, report_name) VALUES ($1, $2, $3, $4)',
      [req.dataOwnerId, userRow.rows[0]?.name || 'Unknown', req.params.id, report.name]
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate report.' });
  }
});

router.get('/export-history', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT downloaded_by, report_name, to_char(downloaded_at, \'YYYY-MM-DD HH24:MI\') AS downloaded_at FROM report_downloads WHERE user_id = $1 ORDER BY downloaded_at DESC LIMIT 30',
      [req.dataOwnerId]
    );
    res.json({ history: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load export history.' });
  }
});

module.exports = router;

const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const userId = req.dataOwnerId;

    const summary = await pool.query(
      `SELECT COUNT(*) AS total_skus,
              COUNT(*) FILTER (WHERE stock < 10 AND out_of_stock = false) AS low_stock,
              COUNT(*) FILTER (WHERE out_of_stock = true) AS out_of_stock,
              COALESCE(SUM(stock),0) AS total_units_in_stock
       FROM products WHERE user_id = $1`,
      [userId]
    );

    const perishableCategories = ['%fruit%', '%vegetable%', '%dairy%', '%meat%', '%fish%', '%egg%', '%bakery%', '%batter%'];
    const perishableRisk = await pool.query(
      `SELECT name, category, stock, units_sold FROM products
       WHERE user_id = $1 AND stock > 0 AND category ILIKE ANY($2)
       ORDER BY stock DESC LIMIT 15`,
      [userId, perishableCategories]
    );

    const lowStockList = await pool.query(
      `SELECT name, category, stock, out_of_stock, units_sold FROM products
       WHERE user_id = $1 AND (stock < 10 OR out_of_stock = true)
       ORDER BY out_of_stock DESC, stock ASC LIMIT 25`,
      [userId]
    );

    const stockByCategory = await pool.query(
      `SELECT COALESCE(category, 'Uncategorized') AS category, COALESCE(SUM(stock),0) AS total_stock, COUNT(*) AS sku_count
       FROM products WHERE user_id = $1 GROUP BY category ORDER BY total_stock DESC LIMIT 10`,
      [userId]
    );

    res.json({
      totalSkus: Number(summary.rows[0].total_skus),
      lowStockCount: Number(summary.rows[0].low_stock),
      outOfStockCount: Number(summary.rows[0].out_of_stock),
      totalUnitsInStock: Number(summary.rows[0].total_units_in_stock),
      perishableRisk: perishableRisk.rows.map(r => ({ name: r.name, category: r.category, stock: r.stock, unitsSold: r.units_sold })),
      lowStockList: lowStockList.rows.map(r => ({ name: r.name, category: r.category, stock: r.stock, outOfStock: r.out_of_stock, unitsSold: r.units_sold })),
      stockByCategory: stockByCategory.rows.map(r => ({ category: r.category, totalStock: Number(r.total_stock), skuCount: Number(r.sku_count) }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load inventory data.' });
  }
});

module.exports = router;

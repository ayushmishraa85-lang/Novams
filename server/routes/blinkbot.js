const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/chat', async (req, res) => {
  try {
    const userId = req.dataOwnerId;
    const message = (req.body.message || '').toLowerCase();

    const totals = await pool.query(
      `SELECT COALESCE(SUM(revenue),0) AS revenue, COALESCE(SUM(quantity),0) AS sales FROM sales WHERE user_id = $1`,
      [userId]
    );
    const revenue = Number(totals.rows[0].revenue);
    const sales = Number(totals.rows[0].sales);

    let reply;

    if (/revenue/.test(message)) {
      reply = `Your total revenue so far is ₹${revenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}.`;
    } else if (/top product|best.?sell/.test(message)) {
      const top = await pool.query(
        `SELECT product_name, SUM(quantity) AS qty FROM sales WHERE user_id = $1 GROUP BY product_name ORDER BY qty DESC LIMIT 1`,
        [userId]
      );
      reply = top.rows.length
        ? `Your top-selling product is "${top.rows[0].product_name}" with ${top.rows[0].qty} units sold.`
        : `I don't have enough sales data yet to identify a top product. Try uploading a CSV of your sales.`;
    } else if (/customer/.test(message)) {
      const c = await pool.query('SELECT COUNT(*) AS count FROM customers WHERE user_id = $1', [userId]);
      reply = `You currently have ${c.rows[0].count} customers on record.`;
    } else if (/sales/.test(message)) {
      reply = `You've recorded ${sales.toLocaleString()} total units sold.`;
    } else if (/stock|inventory/.test(message)) {
      const low = await pool.query('SELECT name, stock FROM products WHERE user_id = $1 AND stock < 10 ORDER BY stock ASC LIMIT 5', [userId]);
      reply = low.rows.length
        ? `Products running low on stock: ${low.rows.map(r => `${r.name} (${r.stock})`).join(', ')}.`
        : `No products are currently low on stock.`;
    } else if (/hello|hi|hey/.test(message)) {
      reply = `Hello! I can answer questions about your revenue, sales, top products, customers, and inventory. What would you like to know?`;
    } else {
      reply = `I can help with questions about revenue, sales, top products, customers, and inventory. Try asking something like "What's my total revenue?" or "What's my top product?"`;
    }

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'BlinkBot failed to respond.' });
  }
});

module.exports = router;

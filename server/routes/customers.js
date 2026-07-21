const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM customers WHERE user_id = $1 ORDER BY total_spent DESC',
      [req.dataOwnerId]
    );

    const stats = await pool.query(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE orders_count > 1) AS repeat_count,
              COUNT(*) FILTER (WHERE is_vip = true) AS vip_count,
              COALESCE(AVG(total_spent),0) AS avg_spent
       FROM customers WHERE user_id = $1`,
      [req.dataOwnerId]
    );
    const s = stats.rows[0];
    const total = Number(s.total);

    res.json({
      customers: result.rows,
      repeatCustomerRate: total > 0 ? (Number(s.repeat_count) / total) * 100 : 0,
      vipCount: Number(s.vip_count),
      avgCustomerSpend: Number(s.avg_spent)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load customers.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, email, total_spent } = req.body;
    if (!name) return res.status(400).json({ error: 'Customer name is required.' });

    const result = await pool.query(
      `INSERT INTO customers (user_id, name, email, total_spent) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.dataOwnerId, name, email || null, total_spent || 0]
    );
    res.json({ customer: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create customer.' });
  }
});

module.exports = router;

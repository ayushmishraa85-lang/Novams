const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM products WHERE user_id = $1 ORDER BY out_of_stock DESC NULLS LAST, stock ASC NULLS LAST, units_sold DESC',
      [req.dataOwnerId]
    );
    res.json({ products: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load products.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, category, price, stock } = req.body;
    if (!name) return res.status(400).json({ error: 'Product name is required.' });

    const result = await pool.query(
      `INSERT INTO products (user_id, name, category, price, stock) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.dataOwnerId, name, category || null, price || 0, stock || 0]
    );
    res.json({ product: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create product.' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, category, price, stock } = req.body;
    const result = await pool.query(
      `UPDATE products SET name = COALESCE($1,name), category = COALESCE($2,category),
       price = COALESCE($3,price), stock = COALESCE($4,stock)
       WHERE id = $5 AND user_id = $6 RETURNING *`,
      [name, category, price, stock, req.params.id, req.dataOwnerId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found.' });
    res.json({ product: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update product.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id = $1 AND user_id = $2', [req.params.id, req.dataOwnerId]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete product.' });
  }
});

module.exports = router;

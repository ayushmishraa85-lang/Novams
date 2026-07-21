const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('owner', 'manager'));

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM employees WHERE user_id = $1 ORDER BY created_at DESC',
      [req.dataOwnerId]
    );
    res.json({ employees: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load employees.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, role_title, shift, contact } = req.body;
    if (!name) return res.status(400).json({ error: 'Employee name is required.' });
    const result = await pool.query(
      `INSERT INTO employees (user_id, name, role_title, shift, contact) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.dataOwnerId, name, role_title || null, shift || null, contact || null]
    );
    res.json({ employee: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add employee.' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, role_title, shift, contact, status } = req.body;
    const result = await pool.query(
      `UPDATE employees SET
         name = COALESCE($1, name), role_title = COALESCE($2, role_title),
         shift = COALESCE($3, shift), contact = COALESCE($4, contact), status = COALESCE($5, status)
       WHERE id = $6 AND user_id = $7 RETURNING *`,
      [name, role_title, shift, contact, status, req.params.id, req.dataOwnerId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Employee not found.' });
    res.json({ employee: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update employee.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM employees WHERE id = $1 AND user_id = $2', [req.params.id, req.dataOwnerId]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove employee.' });
  }
});

module.exports = router;

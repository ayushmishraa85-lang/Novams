const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const userResult = await pool.query(
      'SELECT id, name, email, push_notifications, email_reports, dark_mode, role FROM users WHERE id = $1',
      [req.userId]
    );
    // default_margin_percent is a shared business setting, owned by the org owner
    const marginResult = await pool.query(
      'SELECT default_margin_percent FROM users WHERE id = $1',
      [req.dataOwnerId]
    );
    res.json({
      settings: {
        ...userResult.rows[0],
        default_margin_percent: Number(marginResult.rows[0]?.default_margin_percent ?? 25)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load settings.' });
  }
});

router.put('/', async (req, res) => {
  try {
    const { name, email, push_notifications, email_reports, dark_mode, default_margin_percent } = req.body;
    const result = await pool.query(
      `UPDATE users SET
         name = COALESCE($1, name),
         email = COALESCE($2, email),
         push_notifications = COALESCE($3, push_notifications),
         email_reports = COALESCE($4, email_reports),
         dark_mode = COALESCE($5, dark_mode)
       WHERE id = $6
       RETURNING id, name, email, push_notifications, email_reports, dark_mode, role`,
      [name, email, push_notifications, email_reports, dark_mode, req.userId]
    );

    // Only an Owner can change the shared margin assumption used for the whole business
    if (default_margin_percent !== undefined && req.role === 'owner') {
      await pool.query('UPDATE users SET default_margin_percent = $1 WHERE id = $2', [default_margin_percent, req.dataOwnerId]);
    }

    const marginResult = await pool.query('SELECT default_margin_percent FROM users WHERE id = $1', [req.dataOwnerId]);
    res.json({ settings: { ...result.rows[0], default_margin_percent: Number(marginResult.rows[0]?.default_margin_percent ?? 25) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update settings.' });
  }
});

module.exports = router;

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const VALID_ROLES = ['manager', 'employee', 'analyst'];

// List everyone who shares this business's data (the owner + all team members)
router.get('/', requireRole('owner', 'manager'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, created_at FROM users
       WHERE org_owner_id = $1 ORDER BY (role = 'owner') DESC, created_at ASC`,
      [req.dataOwnerId]
    );
    res.json({ team: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load team members.' });
  }
});

// Only the Owner can add new team member logins
router.post('/', requireRole('owner'), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Name, email, password, and role are required.' });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `Role must be one of: ${VALID_ROLES.join(', ')}.` });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, org_owner_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, created_at`,
      [name, email.toLowerCase(), hash, role, req.dataOwnerId]
    );
    res.json({ member: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add team member.' });
  }
});

// Only the Owner can remove a team member (cannot remove themselves this way)
router.delete('/:id', requireRole('owner'), async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (targetId === req.userId) {
      return res.status(400).json({ error: 'You cannot remove your own Owner account.' });
    }
    await pool.query('DELETE FROM users WHERE id = $1 AND org_owner_id = $2 AND role != $3', [targetId, req.dataOwnerId, 'owner']);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove team member.' });
  }
});

module.exports = router;

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function signToken(userId, rememberMe) {
  const expiresIn = rememberMe ? '30d' : '1d';
  return jwt.sign({ userId }, process.env.JWT_SECRET || 'dev_secret_change_me', { expiresIn });
}

// ---- Simple in-memory rate limiter for login attempts (per email) ----
// Not distributed/persistent - fine for a single Railway instance. For multi-instance
// deployments, swap this for a Redis-backed limiter.
const loginAttempts = new Map(); // email -> { count, firstAttempt }
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(email) {
  const now = Date.now();
  const entry = loginAttempts.get(email);
  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    loginAttempts.set(email, { count: 1, firstAttempt: now });
    return { allowed: true };
  }
  if (entry.count >= MAX_ATTEMPTS) {
    const retryInMin = Math.ceil((WINDOW_MS - (now - entry.firstAttempt)) / 60000);
    return { allowed: false, retryInMin };
  }
  entry.count++;
  return { allowed: true };
}
function clearRateLimit(email) { loginAttempts.delete(email); }

router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required.' });
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
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
      [name, email.toLowerCase(), hash, 'owner']
    );
    const user = result.rows[0];
    // A freshly signed-up user is the owner of their own new business.
    await pool.query('UPDATE users SET org_owner_id = $1 WHERE id = $1', [user.id]);
    const token = signToken(user.id, true);
    res.json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Signup failed.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const normalizedEmail = email.toLowerCase();
    const limit = checkRateLimit(normalizedEmail);
    if (!limit.allowed) {
      return res.status(429).json({ error: `Too many login attempts. Try again in ${limit.retryInMin} minute(s).` });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    clearRateLimit(normalizedEmail);
    const token = signToken(user.id, !!rememberMe);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }

    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    const user = result.rows[0];
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.userId]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to change password.' });
  }
});

// Forgot / reset password.
//
// NOTE: No email provider is configured in this project, so there's nowhere to actually
// send the reset link. To keep this genuinely functional without wiring up SMTP, this
// endpoint returns the reset token directly in the response for the user to use immediately
// (fine for a personal/single-user app). Before using this with real end users, swap in a
// real email service (e.g. Resend, SendGrid, or nodemailer + SMTP) and remove `resetToken`
// from the JSON response - send it by email instead.
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const result = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0) {
      // Don't reveal whether the account exists.
      return res.json({ success: true, message: 'If an account exists for that email, a reset link has been generated.' });
    }

    const userId = result.rows[0].id;
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      'UPDATE users SET reset_token_hash = $1, reset_token_expires = $2 WHERE id = $3',
      [tokenHash, expires, userId]
    );

    res.json({
      success: true,
      message: 'Reset token generated (no email service is configured, so it is returned here directly).',
      resetToken: rawToken,
      expiresInMinutes: 60
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process password reset request.' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required.' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await pool.query(
      'SELECT id FROM users WHERE reset_token_hash = $1 AND reset_token_expires > NOW()',
      [tokenHash]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'That reset link is invalid or has expired.' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = $2',
      [hash, result.rows[0].id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

module.exports = router;

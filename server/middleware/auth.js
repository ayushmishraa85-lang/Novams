const jwt = require('jsonwebtoken');
const { pool } = require('../db');

// Verifies the JWT and attaches:
//   req.userId      - the logged-in person's own id (for profile/identity actions)
//   req.dataOwnerId - the shared business/org id that all business data is scoped by
//                     (equals req.userId for an Owner; equals the Owner's id for
//                     Manager/Employee/Data Analyst team members)
//   req.role        - 'owner' | 'manager' | 'employee' | 'analyst'
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No auth token provided.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_change_me');
    const result = await pool.query('SELECT id, role, org_owner_id FROM users WHERE id = $1', [payload.userId]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User no longer exists.' });
    }
    const user = result.rows[0];
    req.userId = user.id;
    req.dataOwnerId = user.org_owner_id || user.id;
    req.role = user.role || 'owner';
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// Restricts a route to specific roles, e.g. requireRole('owner')
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.role)) {
      return res.status(403).json({ error: 'You do not have permission to access this.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };

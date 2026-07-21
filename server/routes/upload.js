const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Minimal CSV parser that handles quoted fields with commas.
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];

  function parseLine(line) {
    const fields = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { cur += ch; }
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { fields.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    fields.push(cur);
    return fields.map(f => f.trim());
  }

  const headers = parseLine(lines[0]).map(h => h.toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] !== undefined ? values[idx] : ''; });
    rows.push(row);
  }
  return rows;
}

// Expected CSV headers: date, product, category, quantity, revenue, orders, customer_name, customer_email
router.post('/', upload.single('file'), async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const text = req.file.buffer.toString('utf-8');
    const rows = parseCSV(text);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty or could not be parsed.' });
    }

    const required = ['date', 'product'];
    const headers = Object.keys(rows[0]);
    const missing = required.filter(r => !headers.includes(r));
    if (missing.length > 0) {
      return res.status(400).json({
        error: `CSV is missing required column(s): ${missing.join(', ')}. Expected headers: date, product, category, quantity, revenue, orders, customer_name, customer_email, cost (optional), city (optional)`
      });
    }

    await client.query('BEGIN');

    let inserted = 0;
    for (const row of rows) {
      const date = row.date;
      const product = row.product;
      if (!date || !product) continue;

      const category = row.category || null;
      const quantity = parseInt(row.quantity, 10) || 0;
      const revenue = parseFloat(row.revenue) || 0;
      const orders = parseInt(row.orders, 10) || 1;
      const customerName = row.customer_name || null;
      const customerEmail = row.customer_email || null;
      const cost = row.cost !== undefined && row.cost !== '' ? parseFloat(row.cost) : null;
      const city = row.city || null;

      await client.query(
        `INSERT INTO sales (user_id, sale_date, product_name, category, quantity, revenue, orders, customer_name, customer_email, cost, city)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [req.dataOwnerId, date, product, category, quantity, revenue, orders, customerName, customerEmail, cost, city]
      );
      inserted++;

      // Upsert product summary (insert with 0, then increment - avoids double-counting on first insert)
      await client.query(
        `INSERT INTO products (user_id, name, category, units_sold)
         VALUES ($1,$2,$3,0)
         ON CONFLICT (user_id, name) DO NOTHING`,
        [req.dataOwnerId, product, category]
      );
      await client.query(
        `UPDATE products SET units_sold = units_sold + $1 WHERE user_id = $2 AND name = $3`,
        [quantity, req.dataOwnerId, product]
      );

      // Upsert customer summary
      if (customerEmail) {
        await client.query(
          `INSERT INTO customers (user_id, name, email, total_spent, orders_count)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (user_id, email) DO UPDATE SET
             total_spent = customers.total_spent + EXCLUDED.total_spent,
             orders_count = customers.orders_count + EXCLUDED.orders_count`,
          [req.dataOwnerId, customerName || customerEmail, customerEmail, revenue, orders]
        );
      }
    }

    // Mark VIP: top spenders (spend > 3x average)
    await client.query(
      `UPDATE customers SET is_vip = (total_spent > (
         SELECT COALESCE(AVG(total_spent),0) * 3 FROM customers WHERE user_id = $1
       )) WHERE user_id = $1`,
      [req.dataOwnerId]
    );

    await client.query(
      'INSERT INTO uploads (user_id, filename, rows_imported) VALUES ($1,$2,$3)',
      [req.dataOwnerId, req.file.originalname, inserted]
    );

    await client.query('COMMIT');
    res.json({ success: true, rowsImported: inserted });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to process upload.' });
  } finally {
    client.release();
  }
});

router.get('/history', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM uploads WHERE user_id = $1 ORDER BY uploaded_at DESC LIMIT 20',
      [req.dataOwnerId]
    );
    res.json({ uploads: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load upload history.' });
  }
});

module.exports = router;

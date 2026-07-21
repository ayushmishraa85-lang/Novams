// Optional: seed demo data for a given user email so you can see the dashboard populated.
// Usage: EMAIL=you@example.com node server/seed.js
require('dotenv').config();
const { pool, initDb } = require('./db');

async function seed() {
  await initDb();
  const email = (process.env.EMAIL || '').toLowerCase();
  if (!email) {
    console.error('Set EMAIL=you@example.com when running this script (must match an existing signed-up account).');
    process.exit(1);
  }

  const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (userRes.rows.length === 0) {
    console.error('No user found with that email. Sign up in the app first, then re-run this script.');
    process.exit(1);
  }
  const userId = userRes.rows[0].id;

  const categories = ['Electronics', 'Apparel', 'Home Goods', 'Books', 'Toys'];
  const products = ['Wireless Earbuds', 'Running Shoes', 'Coffee Maker', 'Novel Set', 'Building Blocks', 'Smart Watch', 'Backpack'];
  const customers = [
    { name: 'Alice Johnson', email: 'alice@example.com' },
    { name: 'Bob Smith', email: 'bob@example.com' },
    { name: 'Carla Diaz', email: 'carla@example.com' },
    { name: 'David Lee', email: 'david@example.com' }
  ];

  const today = new Date();
  let count = 0;

  for (let monthsAgo = 11; monthsAgo >= 0; monthsAgo--) {
    const monthDate = new Date(today.getFullYear(), today.getMonth() - monthsAgo, 1);
    const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
    const numSalesThisMonth = 15 + Math.floor(Math.random() * 10);

    for (let i = 0; i < numSalesThisMonth; i++) {
      const day = 1 + Math.floor(Math.random() * daysInMonth);
      const saleDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
      const product = products[Math.floor(Math.random() * products.length)];
      const category = categories[Math.floor(Math.random() * categories.length)];
      const quantity = 1 + Math.floor(Math.random() * 8);
      const unitPrice = 15 + Math.random() * 180;
      const revenue = Math.round(quantity * unitPrice * 100) / 100;
      const customer = customers[Math.floor(Math.random() * customers.length)];

      await pool.query(
        `INSERT INTO sales (user_id, sale_date, product_name, category, quantity, revenue, orders, customer_name, customer_email)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [userId, saleDate.toISOString().slice(0, 10), product, category, quantity, revenue, 1, customer.name, customer.email]
      );
      count++;
    }
  }

  // Seed products with stock levels
  for (const p of products) {
    await pool.query(
      `INSERT INTO products (user_id, name, category, price, stock, units_sold)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [userId, p, categories[Math.floor(Math.random() * categories.length)], 20 + Math.random() * 150, Math.floor(Math.random() * 40), Math.floor(Math.random() * 200)]
    );
  }

  // Seed customer totals
  for (const c of customers) {
    const spentRes = await pool.query(
      'SELECT COALESCE(SUM(revenue),0) AS spent, COUNT(*) AS orders FROM sales WHERE user_id = $1 AND customer_email = $2',
      [userId, c.email]
    );
    await pool.query(
      `INSERT INTO customers (user_id, name, email, total_spent, orders_count)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, email) DO UPDATE SET total_spent = EXCLUDED.total_spent, orders_count = EXCLUDED.orders_count`,
      [userId, c.name, c.email, spentRes.rows[0].spent, spentRes.rows[0].orders]
    );
  }
  await pool.query(
    `UPDATE customers SET is_vip = (total_spent > (SELECT COALESCE(AVG(total_spent),0) * 1.5 FROM customers WHERE user_id = $1)) WHERE user_id = $1`,
    [userId]
  );

  console.log(`Seeded ${count} sales records, ${products.length} products, and ${customers.length} customers for ${email}.`);
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });

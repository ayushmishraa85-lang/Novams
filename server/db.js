const { Pool } = require('pg');
const dns = require('dns');

// Node 18+ prefers IPv6 (AAAA records) when resolving hostnames. Some hosts
// (notably Render) advertise an IPv6 address for their Postgres instance that
// isn't actually reachable from the outbound network, causing ENETUNREACH.
// Forcing IPv4-first resolution avoids that without needing any special
// per-provider configuration.
dns.setDefaultResultOrder('ipv4first');

// Works with any Postgres provider (Railway, Render, Supabase, Neon, etc.) that
// injects a DATABASE_URL. Most managed Postgres providers require SSL for external
// connections but use certificates that Node's default strict verification will
// reject, so we enable SSL with rejectUnauthorized:false for anything that isn't
// an explicit plain localhost connection.
const connectionString = process.env.DATABASE_URL;
const isLocal = connectionString && (connectionString.includes('localhost') || connectionString.includes('127.0.0.1'));

const pool = new Pool({
  connectionString,
  ssl: (connectionString && !isLocal) ? { rejectUnauthorized: false } : false
});

// Data-sharing model: every user has an org_owner_id. For an Owner, org_owner_id
// points at their own id. Team members (Manager / Employee / Data Analyst) created
// by an Owner get org_owner_id set to that Owner's id, so all business data (sales,
// products, customers, employees) is scoped by org_owner_id and shared across the
// whole team, while each person still logs in with their own email/password and role.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'owner',
  org_owner_id INTEGER,
  push_notifications BOOLEAN DEFAULT true,
  email_reports BOOLEAN DEFAULT true,
  dark_mode BOOLEAN DEFAULT false,
  default_margin_percent NUMERIC DEFAULT 25,
  reset_token_hash VARCHAR(255),
  reset_token_expires TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  total_spent NUMERIC DEFAULT 0,
  orders_count INTEGER DEFAULT 0,
  is_vip BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, email)
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(255),
  price NUMERIC DEFAULT 0,
  stock INTEGER DEFAULT 0,
  units_sold INTEGER DEFAULT 0,
  mrp NUMERIC,
  discount_percent NUMERIC,
  weight_in_gms NUMERIC,
  out_of_stock BOOLEAN DEFAULT false,
  pack_quantity INTEGER,
  cost_price NUMERIC,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  sale_date DATE NOT NULL,
  product_name VARCHAR(255),
  category VARCHAR(255),
  quantity INTEGER DEFAULT 0,
  revenue NUMERIC DEFAULT 0,
  cost NUMERIC,
  city VARCHAR(255),
  orders INTEGER DEFAULT 1,
  customer_name VARCHAR(255),
  customer_email VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  role_title VARCHAR(255),
  shift VARCHAR(100),
  contact VARCHAR(255),
  status VARCHAR(20) DEFAULT 'Active',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS uploads (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  filename VARCHAR(255),
  rows_imported INTEGER,
  uploaded_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_downloads (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  downloaded_by VARCHAR(255),
  report_id VARCHAR(100),
  report_name VARCHAR(255),
  downloaded_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS datasets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  row_count INTEGER DEFAULT 0,
  columns_schema JSONB,
  uploaded_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dataset_rows (
  id SERIAL PRIMARY KEY,
  dataset_id INTEGER REFERENCES datasets(id) ON DELETE CASCADE,
  row_data JSONB
);

CREATE INDEX IF NOT EXISTS idx_sales_user_date ON sales(user_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_customers_user ON customers(user_id);
CREATE INDEX IF NOT EXISTS idx_products_user ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_employees_user ON employees(user_id);
CREATE INDEX IF NOT EXISTS idx_users_org_owner ON users(org_owner_id);
CREATE INDEX IF NOT EXISTS idx_dataset_rows_dataset ON dataset_rows(dataset_id);
`;

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(SCHEMA);
    // Backfill: any existing user without org_owner_id becomes their own org owner.
    await client.query(`UPDATE users SET org_owner_id = id WHERE org_owner_id IS NULL`);
    console.log('Database schema ready.');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb };

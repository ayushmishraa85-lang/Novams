# Novams

A full-stack Quick Commerce Business Intelligence platform: Node.js/Express backend,
PostgreSQL database, and a vanilla JS frontend (no build step required).

Everything is functional and wired to the database — no mocked numbers anywhere:
- Email/password auth (JWT, bcrypt), with **remember me**, **forgot/reset password**, and
  **login rate limiting**
- **Role-based access** — an Owner can create Manager / Employee / Data Analyst logins that
  share the same business data but each see a role-appropriate set of modules
- **Executive Overview dashboard** — Total Revenue, Total Profit, Total Orders, Profit Margin %,
  and an AI sales forecast, plus Revenue Trend, Revenue by Category, Revenue by City, Top 10
  Products, and Profit Margin by Category charts
- Dedicated modules: **Sales Analytics, Customer Analytics, Product Analytics, Inventory
  Management, Employee & Workforce, AI Business Insights, Sales Forecasting, Reports & Export**
- **Data Explorer** — upload *any* CSV/Excel file, regardless of column names; types are
  auto-detected and charts are generated automatically (see section 7 below)
- Structured **Sales CSV upload** and **Product Catalog (Excel) upload** for quick-commerce data
- **BlinkBot AI** answers questions about your live data by querying the DB directly
- Profit is computed from real `cost` data if you upload it, or an assumed margin % (editable by
  the Owner in Settings) if you don't — always clearly labeled which one is in use

## Architecture

![NovaMS Architecture](docs/architecture.svg)

> **Note on this diagram:** it describes the target/reference architecture for a production
> NovaMS deployment (FastAPI backend, dedicated ML services, etc.). **The code in this repo
> implements the same data flow and features using Node.js/Express instead of FastAPI**, with
> the "Machine Learning" stage implemented as in-process statistical models (linear regression
> forecasting, rule-based segmentation/anomaly detection) rather than separate ML microservices.
> Functionally equivalent, technologically simpler to deploy as a single Railway service. If you
> want the actual FastAPI/Python backend shown in the diagram, that's a separate rewrite — ask
> and it can be scoped out.

## 1. Project structure

```
novams/
├── docs/architecture.svg     System architecture diagram
├── server/                   Express backend
│   ├── index.js              App entry point
│   ├── db.js                 PostgreSQL connection + schema
│   ├── seed.js                Optional demo-data seeder
│   ├── middleware/auth.js     JWT verification + role/org-data resolution
│   └── routes/
│       ├── auth.js            signup, login, change/forgot/reset password
│       ├── team.js            Owner-managed Manager/Employee/Analyst logins
│       ├── employees.js       Dark-store staff roster (CRUD)
│       ├── dashboard.js       Executive Overview summary
│       ├── sales.js           Sales Analytics
│       ├── customers.js       Customer Analytics
│       ├── products.js        Product Analytics (catalog CRUD)
│       ├── inventory.js       Inventory Management
│       ├── forecast.js        Sales Forecasting
│       ├── insights.js        AI Business Insights
│       ├── blinkbot.js        BlinkBot AI chat
│       ├── reports.js         Reports & Export + download history
│       ├── upload.js          Structured sales CSV upload
│       ├── uploadCatalog.js   Product catalog Excel upload
│       ├── datasets.js        Flexible "upload any spreadsheet" Data Explorer
│       └── settings.js        Profile, notifications, margin assumption
├── public/                    Frontend (plain HTML/CSS/JS, no build tools)
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── sample-sales-upload.csv    Example file to test the structured Sales upload
├── zepto-catalog-sample.xlsx  Example multi-sheet product catalog
├── railway.json / Procfile    Railway deployment config
└── package.json
```

## 2. Run locally

**Requirements:** Node 18+, and a PostgreSQL database (local Postgres, or a free one from
[Railway](https://railway.app), [Neon](https://neon.tech), or [Supabase](https://supabase.com)).

```bash
cd novams
npm install
cp .env.example .env
# edit .env and set DATABASE_URL to your Postgres connection string, and set JWT_SECRET
npm start
```

The app will be running at `http://localhost:3000`. On first launch it automatically creates
all the required tables — no manual migration step needed.

Open the app, click **Sign up**, create an account, then:
- Click **⬆ Upload Data** in the top bar and upload `sample-sales-upload.csv` (included) to see
  the dashboard populate with real numbers, **or**
- Run `EMAIL=you@example.com node server/seed.js` after signing up to generate a full year of
  realistic demo data for your account.

### CSV upload format

The upload button accepts a CSV with these headers (only `date` and `product` are required —
the rest default sensibly if omitted):

```
date,product,category,quantity,revenue,orders,customer_name,customer_email
2026-01-05,Wireless Earbuds,Electronics,4,320.00,1,Alice Johnson,alice@example.com
```

Every upload updates sales history, rolls up product "units sold," and rolls up customer
lifetime spend (customers spending 3x the average are auto-flagged as VIP).

## 3. Deploy to Railway

1. Push this project to a GitHub repo (or use Railway's CLI to deploy the folder directly).
2. In Railway, click **New Project → Deploy from GitHub repo** and select this repo.
3. Click **+ New → Database → Add PostgreSQL**. Railway automatically injects a `DATABASE_URL`
   environment variable into your app service — no manual config needed for the DB connection.
4. On your app service, go to **Variables** and add:
   - `JWT_SECRET` — any long random string (used to sign login tokens)
5. Railway will detect the Node app automatically (via `railway.json` / `package.json`) and run
   `npm install` then `npm start`. It also assigns a public URL under **Settings → Networking →
   Generate Domain**.
6. Visit the generated URL — the app creates its database tables automatically on first boot.

That's it: one Railway service running Node + your app, backed by Railway's managed PostgreSQL.

### Optional: seed demo data on Railway

You can run the seeder against your Railway Postgres from your local machine:

```bash
DATABASE_URL="<paste from Railway Postgres 'Connect' tab>" EMAIL=you@example.com node server/seed.js
```

## 4. Product catalog upload (Excel)

Alongside the sales CSV upload, the **Products** page has its own **Upload Catalog (Excel)**
button built specifically for multi-sheet product catalogs like Zepto's public dataset
(`zepto-catalog-sample.xlsx` is included so you can try it immediately). Each sheet is treated
as a category (e.g. "Fruits & Vegetables", "Beverages"), and expects these columns:

```
name, mrp, discountPercent, availableQuantity, discountedSellingPrice, weightInGms, outOfStock, quantity
```

Prices in that format are in paise and are converted to rupees automatically. Re-uploading the
same file updates existing products (matched by name) instead of duplicating them, so it's safe
to re-run after refreshing your source data.

## 5. Authentication features

- Email/password signup and login (bcrypt-hashed passwords, JWT session tokens)
- **Remember me** — checked sessions last 30 days, unchecked sessions last 1 day
- **Change password** from the Settings page (requires current password)
- **Forgot / reset password** — generates a secure, time-limited (1 hour) reset token. Since no
  email provider is wired up, the token is returned directly in the response so the flow is
  usable right away. Before using this with real end users, connect a real email service (e.g.
  Resend, SendGrid, or nodemailer + SMTP) in `server/routes/auth.js` and stop returning the raw
  token in the API response.
- **Login rate limiting** — 5 failed attempts per email locks further attempts for 15 minutes
  (in-memory; fine for a single Railway instance, swap for Redis if you scale to multiple)

## 6. Notes & things you may want to extend

- **BlinkBot AI** currently answers using keyword matching against your live data (revenue,
  top product, customer count, low stock, etc.), not a hosted LLM. If you want it to use a real
  AI model, you can wire `server/routes/blinkbot.js` up to the Anthropic API (or another
  provider) — pass it a summary of the relevant DB numbers as context and forward the user's
  question.
- **AI Insights / Forecast** are computed with straightforward rules and linear regression on
  your historical monthly totals — genuinely derived from your data, but not a machine-learning
  model. This keeps the app fully self-contained with no external API costs.
- Multi-user: every account's data (sales, products, customers) is isolated by `user_id`, so
  multiple people can sign up and each will see only their own dashboard.

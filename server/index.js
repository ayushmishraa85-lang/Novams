require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { initDb } = require('./db');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const salesRoutes = require('./routes/sales');
const revenueRoutes = require('./routes/revenue');
const productsRoutes = require('./routes/products');
const customersRoutes = require('./routes/customers');
const forecastRoutes = require('./routes/forecast');
const insightsRoutes = require('./routes/insights');
const blinkbotRoutes = require('./routes/blinkbot');
const reportsRoutes = require('./routes/reports');
const uploadRoutes = require('./routes/upload');
const uploadCatalogRoutes = require('./routes/uploadCatalog');
const settingsRoutes = require('./routes/settings');
const teamRoutes = require('./routes/team');
const employeesRoutes = require('./routes/employees');
const inventoryRoutes = require('./routes/inventory');
const datasetsRoutes = require('./routes/datasets');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/revenue', revenueRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/forecast', forecastRoutes);
app.use('/api/ai-insights', insightsRoutes);
app.use('/api/blinkbot', blinkbotRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/upload-catalog', uploadCatalogRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/datasets', datasetsRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Serve the frontend
// Serve Chart.js from our own domain (via node_modules) instead of an external CDN.
// This avoids failures from ad-blockers, content blockers, or network policies that
// block third-party CDN domains like cdnjs.cloudflare.com. The exact dist filename
// varies by version/packaging, so we check for whichever one actually exists rather
// than assuming a specific name.
app.get('/vendor/chart.js.js', (req, res) => {
  const distDir = path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist');
  const candidates = ['chart.umd.js', 'chart.umd.min.js', 'chart.js'];
  for (const name of candidates) {
    const filePath = path.join(distDir, name);
    if (fs.existsSync(filePath)) {
      res.set('Content-Type', 'application/javascript');
      return res.sendFile(filePath);
    }
  }
  console.error('Chart.js dist file not found in node_modules. Checked:', candidates);
  res.status(404).type('application/javascript').send('console.error("Chart.js not found on server - check node_modules/chart.js/dist");');
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Novams server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

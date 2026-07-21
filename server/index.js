require('dotenv').config();
const path = require('path');
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

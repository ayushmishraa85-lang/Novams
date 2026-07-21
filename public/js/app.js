// ===== State =====
let TOKEN = localStorage.getItem('token') || null;
let CURRENT_USER = JSON.parse(localStorage.getItem('user') || 'null');
let chartInstances = {};

// ===== API helper =====
async function api(path, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;

  const res = await fetch('/api' + path, Object.assign({}, options, { headers }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast' + (isError ? ' error' : '');
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

function money(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function num(n) { return Number(n || 0).toLocaleString(); }
function pct(n) { return (n >= 0 ? '+' : '') + Number(n || 0).toFixed(1) + '%'; }
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function destroyChart(id) {
  if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}

// ===== Auth =====
document.getElementById('show-signup').onclick = (e) => { e.preventDefault(); toggleAuthForm('signup'); };
document.getElementById('show-login').onclick = (e) => { e.preventDefault(); toggleAuthForm('login'); };
document.getElementById('show-forgot').onclick = (e) => { e.preventDefault(); toggleAuthForm('forgot'); };
document.getElementById('back-to-login').onclick = (e) => { e.preventDefault(); toggleAuthForm('login'); };

function toggleAuthForm(which) {
  document.getElementById('login-form').classList.toggle('hidden', which !== 'login');
  document.getElementById('signup-form').classList.toggle('hidden', which !== 'signup');
  document.getElementById('forgot-form').classList.toggle('hidden', which !== 'forgot');
}

document.getElementById('login-btn').onclick = async () => {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const rememberMe = document.getElementById('login-remember').checked;
  const errBox = document.getElementById('login-error');
  errBox.classList.add('hidden');
  try {
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, rememberMe }) });
    onAuthSuccess(data);
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  }
};

document.getElementById('signup-btn').onclick = async () => {
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const errBox = document.getElementById('signup-error');
  errBox.classList.add('hidden');
  try {
    const data = await api('/auth/signup', { method: 'POST', body: JSON.stringify({ name, email, password }) });
    onAuthSuccess(data);
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  }
};

document.getElementById('forgot-btn').onclick = async () => {
  const email = document.getElementById('forgot-email').value.trim();
  const errBox = document.getElementById('forgot-error');
  const successBox = document.getElementById('forgot-success');
  errBox.classList.add('hidden'); successBox.classList.add('hidden');
  try {
    const data = await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
    successBox.textContent = data.resetToken ? `${data.message} Token: ${data.resetToken}` : data.message;
    successBox.classList.remove('hidden');
    document.getElementById('reset-fields').classList.remove('hidden');
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  }
};

document.getElementById('reset-btn').onclick = async () => {
  const token = document.getElementById('reset-token').value.trim();
  const newPassword = document.getElementById('reset-new-password').value;
  const errBox = document.getElementById('forgot-error');
  const successBox = document.getElementById('forgot-success');
  errBox.classList.add('hidden');
  try {
    await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword }) });
    successBox.textContent = 'Password reset! You can now sign in with your new password.';
    successBox.classList.remove('hidden');
    document.getElementById('reset-fields').classList.add('hidden');
    setTimeout(() => toggleAuthForm('login'), 1500);
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  }
};

function onAuthSuccess(data) {
  TOKEN = data.token;
  CURRENT_USER = data.user;
  localStorage.setItem('token', TOKEN);
  localStorage.setItem('user', JSON.stringify(CURRENT_USER));
  showApp();
  showToast('Welcome back!');
  navigate('dashboard');
}

document.getElementById('logout-btn').onclick = () => {
  TOKEN = null; CURRENT_USER = null;
  localStorage.removeItem('token'); localStorage.removeItem('user');
  showAuth();
};

function showAuth() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  toggleAuthForm('login');
}

const ROLE_LABELS = { owner: 'Owner', manager: 'Manager', employee: 'Employee', analyst: 'Data Analyst' };

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  document.getElementById('sidebar-user-name').textContent = CURRENT_USER.name;
  document.getElementById('sidebar-user-email').textContent = CURRENT_USER.email;
  document.getElementById('user-avatar').textContent = (CURRENT_USER.name || '?')[0].toUpperCase();
  const roleBadge = document.getElementById('sidebar-role-badge');
  roleBadge.textContent = ROLE_LABELS[CURRENT_USER.role] || 'Owner';
  applyRoleVisibility();
}

// ===== Role-based navigation =====
const ROLE_PERMISSIONS = {
  dashboard: ['owner', 'manager', 'employee', 'analyst'],
  sales: ['owner', 'manager', 'analyst'],
  customers: ['owner', 'manager', 'analyst'],
  products: ['owner', 'manager', 'employee', 'analyst'],
  inventory: ['owner', 'manager', 'employee'],
  employees: ['owner', 'manager'],
  'ai-insights': ['owner', 'manager', 'analyst'],
  forecast: ['owner', 'manager', 'analyst'],
  blinkbot: ['owner', 'manager', 'employee', 'analyst'],
  reports: ['owner', 'manager', 'analyst'],
  settings: ['owner', 'manager', 'employee', 'analyst'],
  'data-explorer': ['owner', 'manager', 'analyst']
};

function canAccess(page) {
  const role = (CURRENT_USER && CURRENT_USER.role) || 'owner';
  return (ROLE_PERMISSIONS[page] || []).includes(role);
}

function applyRoleVisibility() {
  document.querySelectorAll('.nav-item').forEach(el => {
    const page = el.dataset.page;
    el.classList.toggle('hidden', !canAccess(page));
  });
}

// ===== Upload =====
document.getElementById('upload-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  try {
    const result = await api('/upload', { method: 'POST', body: formData });
    showToast(`Imported ${result.rowsImported} rows successfully!`);
    navigate(currentPage, true);
  } catch (err) {
    showToast(err.message, true);
  }
  e.target.value = '';
});

// ===== Mobile sidebar =====
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}
document.getElementById('menu-toggle').onclick = () => {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('open');
};
document.getElementById('sidebar-close-btn').onclick = closeSidebar;
document.getElementById('sidebar-overlay').onclick = closeSidebar;

// ===== Routing =====
let currentPage = 'dashboard';
const PAGES = ['dashboard', 'sales', 'customers', 'products', 'inventory', 'employees', 'ai-insights', 'forecast', 'blinkbot', 'reports', 'settings', 'data-explorer'];

window.addEventListener('hashchange', () => {
  const page = location.hash.replace('#', '') || 'dashboard';
  navigate(page);
});

function navigate(page, force = false) {
  if (!PAGES.includes(page)) page = 'dashboard';
  if (!canAccess(page)) page = 'dashboard';
  currentPage = page;
  location.hash = page;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  closeSidebar();
  renderPage(page);
}

async function renderPage(page) {
  const container = document.getElementById('page-content');
  container.innerHTML = '<div class="empty-state">Loading...</div>';
  try {
    switch (page) {
      case 'dashboard': await renderDashboard(container); break;
      case 'sales': await renderSalesAnalytics(container); break;
      case 'customers': await renderCustomerAnalytics(container); break;
      case 'products': await renderProductAnalytics(container); break;
      case 'inventory': await renderInventory(container); break;
      case 'employees': await renderEmployeeWorkforce(container); break;
      case 'ai-insights': await renderInsights(container); break;
      case 'forecast': await renderForecast(container); break;
      case 'blinkbot': await renderBlinkbot(container); break;
      case 'reports': await renderReports(container); break;
      case 'settings': await renderSettings(container); break;
      case 'data-explorer': await renderDataExplorer(container); break;
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="big-icon">⚠</div>${escapeHtml(err.message)}</div>`;
  }
}

function statCard(icon, label, value, changePct, color, footnote) {
  const changeHtml = changePct === null || changePct === undefined ? '' :
    `<div class="stat-change ${changePct >= 0 ? 'up' : 'down'}">${changePct >= 0 ? '↗' : '↘'} ${pct(changePct)} vs last month</div>`;
  return `
    <div class="stat-card">
      <div class="stat-icon ${color}">${icon}</div>
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
      ${changeHtml}
      ${footnote ? `<div class="stat-footnote">${footnote}</div>` : ''}
    </div>`;
}

// ============================================================
// DASHBOARD — Executive Overview (top-line metrics only)
// ============================================================
async function renderDashboard(container) {
  const d = await api('/dashboard/summary');
  const hasData = d.revenueTrend.length > 0;

  const basisNote = {
    actual: 'Based on real cost data',
    partial: 'Partially estimated (some cost data missing)',
    estimated: `Estimated at ${d.assumedMargin}% margin — upload cost data or adjust in Settings for accuracy`,
    none: 'No sales data yet'
  }[d.profitBasis];

  container.innerHTML = `
    <h1>Dashboard</h1>
    <p class="page-sub">Executive Overview — quick commerce performance at a glance.</p>

    <div class="card-grid">
      ${statCard('₹', 'Total Revenue', money(d.totalRevenue), hasData ? d.revenueChangePct : null, 'green')}
      ${statCard('📊', 'Total Profit', money(d.totalProfit), null, 'blue', basisNote)}
      ${statCard('🛒', 'Total Orders', num(d.totalOrders), null, 'purple')}
      ${statCard('📈', 'Profit Margin', d.profitMarginPct.toFixed(1) + '%', null, 'red')}
      ${statCard('🤖', 'AI Sales Forecast (Next Month)', d.nextMonthForecast !== null ? money(d.nextMonthForecast) : '—', null, 'indigo', d.nextMonthForecast === null ? 'Needs 2+ months of data' : 'Projected revenue')}
    </div>

    <div class="chart-grid">
      <div class="panel"><h3>Revenue Trend</h3><div class="chart-container"><canvas id="chart-revenue-trend"></canvas></div></div>
      <div class="panel"><h3>Revenue by Category</h3><div class="chart-container"><canvas id="chart-category"></canvas></div></div>
    </div>

    <div class="chart-grid">
      <div class="panel">
        <h3>Revenue by City</h3>
        ${d.cityBreakdown.length === 0 ? '<div class="empty-state">No city data yet. Include a "city" column in your sales CSV to unlock this.</div>' : '<div class="chart-container"><canvas id="chart-city"></canvas></div>'}
      </div>
      <div class="panel">
        <h3>Profit Margin by Category</h3>
        ${d.marginByCategory.length === 0 ? '<div class="empty-state">No data yet.</div>' : '<div class="chart-container"><canvas id="chart-margin-category"></canvas></div>'}
      </div>
    </div>

    <div class="panel">
      <h3>Top 10 Products</h3>
      ${d.topProducts.length === 0 ? '<div class="empty-state">No product sales yet.</div>' : `<div class="chart-container" style="height:${Math.max(220, d.topProducts.length * 34)}px;"><canvas id="chart-top-products"></canvas></div>`}
    </div>

    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h3 style="margin:0;">AI Insights</h3>
        <a href="#ai-insights" style="font-size:13.5px;font-weight:600;">View all insights →</a>
      </div>
      ${d.insights.length === 0 ? '<div class="empty-state">Upload sales data to generate insights.</div>' : d.insights.map(i => `
        <div class="insight-card ${i.priority === 'High' ? '' : 'medium-border'}">
          <div><h4>${escapeHtml(i.title)}</h4><p>${escapeHtml(i.description)}</p></div>
          <div class="insight-meta"><span class="badge ${i.priority === 'High' ? 'high' : 'medium'}">${i.priority} Priority</span></div>
        </div>
      `).join('')}
    </div>
  `;

  if (!hasData) return;

  destroyChart('rt');
  chartInstances['rt'] = new Chart(document.getElementById('chart-revenue-trend'), {
    type: 'line',
    data: { labels: d.revenueTrend.map(r => r.month), datasets: [{ label: 'Revenue', data: d.revenueTrend.map(r => r.revenue), borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)', fill: true, tension: 0.3 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  destroyChart('cat');
  chartInstances['cat'] = new Chart(document.getElementById('chart-category'), {
    type: 'bar',
    data: { labels: d.categoryBreakdown.map(c => c.category), datasets: [{ label: 'Revenue', data: d.categoryBreakdown.map(c => c.revenue), backgroundColor: '#6366f1' }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  if (d.cityBreakdown.length > 0) {
    destroyChart('city');
    chartInstances['city'] = new Chart(document.getElementById('chart-city'), {
      type: 'bar',
      data: { labels: d.cityBreakdown.map(c => c.city), datasets: [{ label: 'Revenue', data: d.cityBreakdown.map(c => c.revenue), backgroundColor: '#16a34a' }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }

  if (d.marginByCategory.length > 0) {
    destroyChart('mc');
    chartInstances['mc'] = new Chart(document.getElementById('chart-margin-category'), {
      type: 'bar',
      data: { labels: d.marginByCategory.map(c => c.category), datasets: [{ label: 'Margin %', data: d.marginByCategory.map(c => c.marginPct), backgroundColor: '#f59e0b' }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }

  if (d.topProducts.length > 0) {
    destroyChart('tp');
    chartInstances['tp'] = new Chart(document.getElementById('chart-top-products'), {
      type: 'bar',
      data: { labels: d.topProducts.map(p => p.name), datasets: [{ label: 'Revenue', data: d.topProducts.map(p => p.revenue), backgroundColor: '#6366f1' }] },
      options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }
}

// ============================================================
// SALES ANALYTICS
// ============================================================
async function renderSalesAnalytics(container) {
  const d = await api('/sales');
  container.innerHTML = `
    <h1>Sales Analytics</h1>
    <p class="page-sub">Detailed sales performance, transactions, and order patterns.</p>

    <div class="card-grid" style="grid-template-columns: repeat(3, 1fr);">
      <div class="mini-stat"><span class="mini-stat-label">Avg Basket Size</span><span class="mini-stat-value">${d.avgBasketSize.toFixed(1)} items</span></div>
      <div class="mini-stat"><span class="mini-stat-label">Weekday Revenue</span><span class="mini-stat-value">${money(d.weekendVsWeekday.weekday)}</span></div>
      <div class="mini-stat"><span class="mini-stat-label">Weekend Revenue</span><span class="mini-stat-value">${money(d.weekendVsWeekday.weekend)}</span></div>
    </div>

    <div class="panel"><h3>Sales Trend</h3><div class="chart-container"><canvas id="chart-sales-trend"></canvas></div></div>

    <div class="panel">
      <h3>Monthly Breakdown</h3>
      <table>
        <thead><tr><th>Month</th><th>Sales</th><th>Revenue</th><th>Orders</th></tr></thead>
        <tbody>
          ${d.monthlyBreakdown.length ? d.monthlyBreakdown.map(r => `
            <tr><td>${r.month}</td><td>${num(r.sales)}</td><td>${money(r.revenue)}</td><td>${num(r.orders)}</td></tr>
          `).join('') : '<tr><td colspan="4" class="muted" style="padding:20px 8px;">No data yet — upload a CSV to see your monthly breakdown.</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="panel">
      <h3>Recent Transactions</h3>
      ${d.recentTransactions.length === 0 ? '<div class="empty-state">No transactions yet.</div>' : `
      <table>
        <thead><tr><th>Date</th><th>Product</th><th>Category</th><th>Qty</th><th>Revenue</th><th>Customer</th></tr></thead>
        <tbody>
          ${d.recentTransactions.map(t => `
            <tr><td>${t.date}</td><td>${escapeHtml(t.product)}</td><td>${escapeHtml(t.category || '—')}</td><td>${num(t.quantity)}</td><td>${money(t.revenue)}</td><td>${escapeHtml(t.customer || '—')}</td></tr>
          `).join('')}
        </tbody>
      </table>`}
    </div>
  `;

  if (d.trend.length > 0) {
    destroyChart('st');
    chartInstances['st'] = new Chart(document.getElementById('chart-sales-trend'), {
      type: 'line',
      data: { labels: d.trend.map(r => r.month), datasets: [{ label: 'Sales', data: d.trend.map(r => r.sales), borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.1)', fill: true, tension: 0.3 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: true } } }
    });
  } else {
    document.getElementById('chart-sales-trend').parentElement.innerHTML = '<h3>Sales Trend</h3><div class="empty-state">No sales data yet.</div>';
  }
}

// ============================================================
// CUSTOMER ANALYTICS
// ============================================================
async function renderCustomerAnalytics(container) {
  const d = await api('/customers');
  container.innerHTML = `
    <h1>Customer Analytics</h1>
    <p class="page-sub">Customer behavior, retention, and lifetime value.</p>

    <div class="card-grid" style="grid-template-columns: repeat(3, 1fr);">
      <div class="mini-stat"><span class="mini-stat-label">Repeat Customer Rate</span><span class="mini-stat-value">${d.repeatCustomerRate.toFixed(0)}%</span></div>
      <div class="mini-stat"><span class="mini-stat-label">VIP Customers</span><span class="mini-stat-value">${num(d.vipCount)}</span></div>
      <div class="mini-stat"><span class="mini-stat-label">Avg Customer Spend</span><span class="mini-stat-value">${money(d.avgCustomerSpend)}</span></div>
    </div>

    <div id="customer-list">
      ${d.customers.length ? d.customers.map(c => `
        <div class="customer-row">
          <div>
            <h4>${escapeHtml(c.name)} ${c.is_vip ? '<span class="badge medium">VIP</span>' : ''}</h4>
            <p>${escapeHtml(c.email || '')} · Total spent: ${money(c.total_spent)} · Orders: ${c.orders_count}</p>
          </div>
        </div>
      `).join('') : '<div class="empty-state">No customers yet. Upload a sales CSV with customer_email to populate this list.</div>'}
    </div>
  `;
}

// ============================================================
// PRODUCT ANALYTICS
// ============================================================
async function renderProductAnalytics(container) {
  const d = await api('/products');
  const avgUnitsSold = d.products.length ? d.products.reduce((s, p) => s + p.units_sold, 0) / d.products.length : 0;

  container.innerHTML = `
    <h1>Product Analytics</h1>
    <p class="page-sub">Manage your product catalog and track SKU performance.</p>
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h3 style="margin:0;">Upload Product Catalog</h3>
        <label class="upload-btn" style="cursor:pointer;">
          ⬆ Upload Catalog (Excel)
          <input type="file" id="catalog-upload-input" accept=".xlsx,.xls" hidden />
        </label>
      </div>
      <p class="muted" style="margin:0;font-size:13px;">
        Accepts a multi-sheet workbook where each sheet is a category (name, mrp, discountPercent,
        availableQuantity, discountedSellingPrice, weightInGms, outOfStock, quantity columns).
      </p>
    </div>
    <div class="panel">
      <h3>Add Product Manually</h3>
      <div class="form-row">
        <input id="p-name" placeholder="Product name" />
        <input id="p-category" placeholder="Category" />
        <input id="p-price" placeholder="Price" type="number" step="0.01" />
        <input id="p-stock" placeholder="Stock" type="number" />
        <button class="btn-dark" id="add-product-btn">Add Product</button>
      </div>
    </div>
    <div id="product-list">
      ${d.products.length ? d.products.map(p => `
        <div class="product-row">
          <div>
            <h4>${escapeHtml(p.name)}
              ${p.out_of_stock ? '<span class="badge high">Out of Stock</span>' : (p.stock < 10 ? '<span class="badge medium">Low Stock</span>' : '')}
              ${p.units_sold >= avgUnitsSold && p.units_sold > 0 ? '<span class="badge low">Fast Moving</span>' : ''}
            </h4>
            <p>${escapeHtml(p.category || 'Uncategorized')} · ${money(p.price)}${p.mrp ? ` <s style="color:#9ca3af;">${money(p.mrp)}</s>` : ''}${p.discount_percent ? ` · ${Number(p.discount_percent).toFixed(0)}% off` : ''} · Stock: ${p.stock}${p.units_sold ? ` · Sold: ${p.units_sold}` : ''}${p.weight_in_gms ? ` · ${p.weight_in_gms}g` : ''}</p>
          </div>
          <button class="btn-secondary" onclick="deleteProduct(${p.id})">Delete</button>
        </div>
      `).join('') : '<div class="empty-state">No products yet. Add one above, or upload a catalog / sales CSV.</div>'}
    </div>
  `;

  document.getElementById('catalog-upload-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const result = await api('/upload-catalog', { method: 'POST', body: formData });
      showToast(`Imported ${result.rowsImported} products across ${result.sheetsProcessed} categories!`);
      navigate('products', true);
    } catch (err) { showToast(err.message, true); }
    e.target.value = '';
  });

  document.getElementById('add-product-btn').onclick = async () => {
    const name = document.getElementById('p-name').value.trim();
    if (!name) return showToast('Product name is required.', true);
    try {
      await api('/products', {
        method: 'POST',
        body: JSON.stringify({
          name,
          category: document.getElementById('p-category').value.trim(),
          price: parseFloat(document.getElementById('p-price').value) || 0,
          stock: parseInt(document.getElementById('p-stock').value) || 0
        })
      });
      showToast('Product added!');
      navigate('products', true);
    } catch (err) { showToast(err.message, true); }
  };
}

async function deleteProduct(id) {
  try {
    await api('/products/' + id, { method: 'DELETE' });
    showToast('Product deleted.');
    navigate('products', true);
  } catch (err) { showToast(err.message, true); }
}

// ============================================================
// INVENTORY MANAGEMENT
// ============================================================
async function renderInventory(container) {
  const d = await api('/inventory');
  container.innerHTML = `
    <h1>Inventory Management</h1>
    <p class="page-sub">Stock health, restocking priorities, and perishable-item risk.</p>

    <div class="card-grid">
      ${statCard('📦', 'Total SKUs', num(d.totalSkus), null, 'blue')}
      ${statCard('⚠', 'Low Stock', num(d.lowStockCount), null, d.lowStockCount > 0 ? 'red' : 'green')}
      ${statCard('🚫', 'Out of Stock', num(d.outOfStockCount), null, d.outOfStockCount > 0 ? 'red' : 'green')}
      ${statCard('🧮', 'Units in Stock', num(d.totalUnitsInStock), null, 'purple')}
    </div>

    <div class="panel">
      <h3>Stock by Category</h3>
      ${d.stockByCategory.length === 0 ? '<div class="empty-state">No product data yet.</div>' : '<div class="chart-container"><canvas id="chart-stock-category"></canvas></div>'}
    </div>

    <div class="panel">
      <h3>Perishable Stock Risk</h3>
      <p class="muted" style="margin-top:-6px;font-size:13px;">Fruits, vegetables, dairy, meat, and bakery items currently in stock — prioritize fast turnover.</p>
      ${d.perishableRisk.length === 0 ? '<div class="empty-state">No perishable stock detected.</div>' : `
      <table>
        <thead><tr><th>Product</th><th>Category</th><th>Stock</th><th>Units Sold</th></tr></thead>
        <tbody>${d.perishableRisk.map(p => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.category || '—')}</td><td>${num(p.stock)}</td><td>${num(p.unitsSold)}</td></tr>`).join('')}</tbody>
      </table>`}
    </div>

    <div class="panel">
      <h3>Low / Out of Stock Items</h3>
      ${d.lowStockList.length === 0 ? '<div class="empty-state">Everything is well stocked.</div>' : `
      <table>
        <thead><tr><th>Product</th><th>Category</th><th>Stock</th><th>Status</th></tr></thead>
        <tbody>${d.lowStockList.map(p => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.category || '—')}</td><td>${num(p.stock)}</td><td>${p.outOfStock ? '<span class="badge high">Out of Stock</span>' : '<span class="badge medium">Low</span>'}</td></tr>`).join('')}</tbody>
      </table>`}
    </div>
  `;

  if (d.stockByCategory.length > 0) {
    destroyChart('sc');
    chartInstances['sc'] = new Chart(document.getElementById('chart-stock-category'), {
      type: 'bar',
      data: { labels: d.stockByCategory.map(c => c.category), datasets: [{ label: 'Units in Stock', data: d.stockByCategory.map(c => c.totalStock), backgroundColor: '#6366f1' }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }
}

// ============================================================
// EMPLOYEE & WORKFORCE
// ============================================================
async function renderEmployeeWorkforce(container) {
  const isOwner = CURRENT_USER.role === 'owner';
  let teamHtml = '<div class="empty-state">Only Owners and Managers can view team logins.</div>';
  let team = [];
  try {
    const teamData = await api('/team');
    team = teamData.team;
  } catch (e) { /* not permitted */ }

  const employeesData = await api('/employees');

  container.innerHTML = `
    <h1>Employee & Workforce</h1>
    <p class="page-sub">Manage dashboard team logins and dark-store staff.</p>

    <div class="panel">
      <h3>Team Logins</h3>
      <p class="muted" style="margin-top:-6px;font-size:13px;">People who can log into this Novams dashboard, each with a role-appropriate view.</p>
      ${team.map(m => `
        <div class="rank-row">
          <div style="flex:1;">
            <div style="font-weight:600;font-size:14px;">${escapeHtml(m.name)} <span class="badge low" style="margin-left:6px;">${ROLE_LABELS[m.role] || m.role}</span></div>
            <div style="color:#6b7280;font-size:12.5px;">${escapeHtml(m.email)}</div>
          </div>
          ${isOwner && m.role !== 'owner' ? `<button class="btn-secondary" onclick="removeTeamMember(${m.id})">Remove</button>` : ''}
        </div>
      `).join('')}
      ${isOwner ? `
      <div class="form-row" style="margin-top:16px;">
        <input id="tm-name" placeholder="Full name" />
        <input id="tm-email" placeholder="Email" type="email" />
        <input id="tm-password" placeholder="Temporary password" type="password" />
        <select id="tm-role">
          <option value="manager">Manager</option>
          <option value="employee">Employee</option>
          <option value="analyst">Data Analyst</option>
        </select>
        <button class="btn-dark" id="add-team-btn">Add Team Member</button>
      </div>` : ''}
    </div>

    <div class="panel">
      <h3>Dark Store Staff</h3>
      <p class="muted" style="margin-top:-6px;font-size:13px;">Roster of on-ground staff (pickers, packers, riders) — not dashboard logins.</p>
      <div class="form-row">
        <input id="emp-name" placeholder="Name" />
        <input id="emp-role" placeholder="Role (e.g. Picker, Rider)" />
        <input id="emp-shift" placeholder="Shift (e.g. Morning)" />
        <input id="emp-contact" placeholder="Contact" />
        <button class="btn-dark" id="add-employee-btn">Add Staff</button>
      </div>
      ${employeesData.employees.length === 0 ? '<div class="empty-state">No staff added yet.</div>' : employeesData.employees.map(e => `
        <div class="product-row">
          <div>
            <h4>${escapeHtml(e.name)} <span class="badge low">${escapeHtml(e.status)}</span></h4>
            <p>${escapeHtml(e.role_title || '—')} · ${escapeHtml(e.shift || 'No shift set')} · ${escapeHtml(e.contact || '—')}</p>
          </div>
          <button class="btn-secondary" onclick="deleteEmployee(${e.id})">Remove</button>
        </div>
      `).join('')}
    </div>
  `;

  if (isOwner) {
    document.getElementById('add-team-btn').onclick = async () => {
      try {
        await api('/team', {
          method: 'POST',
          body: JSON.stringify({
            name: document.getElementById('tm-name').value.trim(),
            email: document.getElementById('tm-email').value.trim(),
            password: document.getElementById('tm-password').value,
            role: document.getElementById('tm-role').value
          })
        });
        showToast('Team member added!');
        navigate('employees', true);
      } catch (err) { showToast(err.message, true); }
    };
  }

  document.getElementById('add-employee-btn').onclick = async () => {
    const name = document.getElementById('emp-name').value.trim();
    if (!name) return showToast('Name is required.', true);
    try {
      await api('/employees', {
        method: 'POST',
        body: JSON.stringify({
          name,
          role_title: document.getElementById('emp-role').value.trim(),
          shift: document.getElementById('emp-shift').value.trim(),
          contact: document.getElementById('emp-contact').value.trim()
        })
      });
      showToast('Staff member added!');
      navigate('employees', true);
    } catch (err) { showToast(err.message, true); }
  };
}

async function removeTeamMember(id) {
  try {
    await api('/team/' + id, { method: 'DELETE' });
    showToast('Team member removed.');
    navigate('employees', true);
  } catch (err) { showToast(err.message, true); }
}

async function deleteEmployee(id) {
  try {
    await api('/employees/' + id, { method: 'DELETE' });
    showToast('Staff member removed.');
    navigate('employees', true);
  } catch (err) { showToast(err.message, true); }
}

// ============================================================
// AI BUSINESS INSIGHTS
// ============================================================
async function renderInsights(container) {
  const d = await api('/ai-insights');
  const priorityClass = p => p === 'High' ? '' : (p === 'Medium' ? 'medium-border' : 'low-border');
  const badgeClass = p => p === 'High' ? 'high' : (p === 'Medium' ? 'medium' : 'low');
  container.innerHTML = `
    <h1>AI Business Insights</h1>
    <p class="page-sub">AI-powered business intelligence and recommendations for your quick commerce operations.</p>
    ${d.insights.map(i => `
      <div class="insight-card ${priorityClass(i.priority)}">
        <div><h4>${escapeHtml(i.title)}</h4><p>${escapeHtml(i.description)}</p></div>
        <div class="insight-meta"><span class="badge ${badgeClass(i.priority)}">${i.priority} Priority</span><span class="impact">Impact: ${i.impact}</span></div>
      </div>
    `).join('')}
  `;
}

// ============================================================
// SALES FORECASTING
// ============================================================
async function renderForecast(container) {
  const d = await api('/forecast');
  container.innerHTML = `
    <h1>Sales Forecasting</h1>
    <p class="page-sub">AI-powered predictions for upcoming months based on your historical data.</p>
    <div class="panel"><h3>6-Month Forecast</h3><div class="chart-container"><canvas id="chart-forecast"></canvas></div></div>
    <div class="panel">
      <h3>Forecast Details</h3>
      ${!d.hasEnoughData ? '<div class="empty-state">Upload at least two months of sales data to generate a reliable forecast.</div>' : `
      <table>
        <thead><tr><th>Month</th><th>Predicted Sales</th><th>Predicted Revenue</th><th>Confidence</th></tr></thead>
        <tbody>
          ${d.forecast.map(f => `<tr><td>${f.month}</td><td>📈 ${num(f.predictedSales)}</td><td>${money(f.predictedRevenue)}</td><td>${f.confidence}%</td></tr>`).join('')}
        </tbody>
      </table>`}
    </div>
  `;

  if (!d.hasEnoughData) return;
  destroyChart('fc');
  chartInstances['fc'] = new Chart(document.getElementById('chart-forecast'), {
    type: 'line',
    data: {
      labels: d.forecast.map(f => f.month),
      datasets: [
        { label: 'Predicted Revenue', data: d.forecast.map(f => f.predictedRevenue), borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)', fill: true, tension: 0.3 },
        { label: 'Predicted Sales', data: d.forecast.map(f => f.predictedSales), borderColor: '#a78bfa', borderDash: [6, 4], yAxisID: 'y1' }
      ]
    },
    options: { maintainAspectRatio: false, scales: { y1: { position: 'right', grid: { drawOnChartArea: false } } } }
  });
}

// ============================================================
// BLINKBOT AI
// ============================================================
async function renderBlinkbot(container) {
  container.innerHTML = `
    <h1>BlinkBot AI</h1>
    <p class="page-sub">Your intelligent business assistant.</p>
    <div class="panel chat-window">
      <div class="chat-messages" id="chat-messages">
        <div class="chat-bubble">Hello! I'm BlinkBot, your AI business intelligence assistant. Ask me about revenue, sales, top products, customers, or inventory.</div>
      </div>
      <div class="chat-input-row">
        <textarea id="chat-input" placeholder="Ask me anything about your business..." rows="1"></textarea>
        <button class="chat-send" id="chat-send">➤</button>
      </div>
    </div>
  `;

  const sendMessage = async () => {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    appendChat(message, true);
    try {
      const res = await api('/blinkbot/chat', { method: 'POST', body: JSON.stringify({ message }) });
      appendChat(res.reply, false);
    } catch (err) {
      appendChat('Sorry, I ran into an error: ' + err.message, false);
    }
  };

  document.getElementById('chat-send').onclick = sendMessage;
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
}

function appendChat(text, isUser) {
  const box = document.getElementById('chat-messages');
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble' + (isUser ? ' user' : '');
  bubble.textContent = text;
  box.appendChild(bubble);
  box.scrollTop = box.scrollHeight;
}

// ============================================================
// REPORTS & EXPORT
// ============================================================
async function renderReports(container) {
  const d = await api('/reports');
  let history = [];
  try { history = (await api('/reports/export-history')).history; } catch (e) {}

  container.innerHTML = `
    <h1>Reports & Export</h1>
    <p class="page-sub">Download business reports as CSV, generated live from your data.</p>
    ${d.reports.map(r => `
      <div class="report-row">
        <div><h4>${escapeHtml(r.name)}</h4><p>${escapeHtml(r.description)} <span class="tag">${r.format}</span></p></div>
        <button class="btn-secondary" onclick="downloadReport('${r.id}')">⬇ Download</button>
      </div>
    `).join('')}

    <div class="panel" style="margin-top:20px;">
      <h3>Export History</h3>
      ${history.length === 0 ? '<div class="empty-state">No reports downloaded yet.</div>' : `
      <table>
        <thead><tr><th>Report</th><th>Downloaded By</th><th>When</th></tr></thead>
        <tbody>${history.map(h => `<tr><td>${escapeHtml(h.report_name)}</td><td>${escapeHtml(h.downloaded_by)}</td><td>${h.downloaded_at}</td></tr>`).join('')}</tbody>
      </table>`}
    </div>
  `;
}

function downloadReport(id) {
  const url = '/api/reports/' + id + '/download';
  fetch(url, { headers: { Authorization: 'Bearer ' + TOKEN } })
    .then(res => res.blob())
    .then(blob => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = id + '.csv';
      link.click();
      setTimeout(() => navigate('reports', true), 500);
    })
    .catch(() => showToast('Failed to download report.', true));
}

// ============================================================
// SETTINGS
// ============================================================
async function renderSettings(container) {
  const d = await api('/settings');
  const s = d.settings;
  const isOwner = s.role === 'owner';

  container.innerHTML = `
    <h1>Settings</h1>
    <p class="page-sub">Manage your account settings and preferences.</p>
    <div class="panel">
      <h3>Profile Information</h3>
      <div class="form-row"><input id="s-name" value="${escapeHtml(s.name)}" placeholder="Full name" /></div>
      <div class="form-row"><input id="s-email" value="${escapeHtml(s.email)}" placeholder="Email" /></div>
      <p class="muted" style="font-size:13px;">Role: <strong>${ROLE_LABELS[s.role] || s.role}</strong></p>
      <button class="btn-dark" id="save-profile-btn">Save Changes</button>
    </div>

    <div class="panel">
      <h3>Notifications</h3>
      <div class="settings-row">
        <div><h4>Push Notifications</h4><p>Receive notifications about important updates</p></div>
        <label class="toggle"><input type="checkbox" id="s-push" ${s.push_notifications ? 'checked' : ''}/><span class="slider"></span></label>
      </div>
      <div class="settings-row">
        <div><h4>Email Reports</h4><p>Receive weekly reports via email</p></div>
        <label class="toggle"><input type="checkbox" id="s-email-reports" ${s.email_reports ? 'checked' : ''}/><span class="slider"></span></label>
      </div>
    </div>

    <div class="panel">
      <h3>Profit Calculation</h3>
      <p class="muted" style="margin-top:-6px;font-size:13px;">
        Used to estimate profit for sales rows uploaded without real cost data. This is shared across your whole business.
      </p>
      <div class="form-row">
        <input id="s-margin" type="number" step="0.1" value="${s.default_margin_percent}" ${isOwner ? '' : 'disabled'} />
        <span class="muted" style="align-self:center;">% assumed profit margin</span>
      </div>
      ${!isOwner ? '<p class="muted" style="font-size:12.5px;">Only the Owner can change this setting.</p>' : ''}
      ${isOwner ? '<button class="btn-dark" id="save-margin-btn">Save Margin Setting</button>' : ''}
    </div>

    <div class="panel">
      <h3>Change Password</h3>
      <div id="password-error" class="form-error hidden"></div>
      <div class="form-row">
        <input id="s-current-password" type="password" placeholder="Current password" />
        <input id="s-new-password" type="password" placeholder="New password (min. 6 characters)" />
      </div>
      <button class="btn-dark" id="change-password-btn">Update Password</button>
    </div>
  `;

  document.getElementById('save-profile-btn').onclick = async () => {
    try {
      const updated = await api('/settings', {
        method: 'PUT',
        body: JSON.stringify({
          name: document.getElementById('s-name').value.trim(),
          email: document.getElementById('s-email').value.trim(),
          push_notifications: document.getElementById('s-push').checked,
          email_reports: document.getElementById('s-email-reports').checked
        })
      });
      CURRENT_USER = { ...CURRENT_USER, ...updated.settings };
      localStorage.setItem('user', JSON.stringify(CURRENT_USER));
      showApp();
      showToast('Settings saved!');
    } catch (err) { showToast(err.message, true); }
  };
  document.getElementById('s-push').onchange = document.getElementById('save-profile-btn').onclick;
  document.getElementById('s-email-reports').onchange = document.getElementById('save-profile-btn').onclick;

  if (isOwner) {
    document.getElementById('save-margin-btn').onclick = async () => {
      try {
        await api('/settings', { method: 'PUT', body: JSON.stringify({ default_margin_percent: parseFloat(document.getElementById('s-margin').value) || 0 }) });
        showToast('Margin setting saved!');
      } catch (err) { showToast(err.message, true); }
    };
  }

  document.getElementById('change-password-btn').onclick = async () => {
    const errBox = document.getElementById('password-error');
    errBox.classList.add('hidden');
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: document.getElementById('s-current-password').value,
          newPassword: document.getElementById('s-new-password').value
        })
      });
      document.getElementById('s-current-password').value = '';
      document.getElementById('s-new-password').value = '';
      showToast('Password updated!');
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    }
  };
}

// ============================================================
// DATA EXPLORER — upload any CSV/Excel, auto-detect columns, auto-chart
// ============================================================
let viewingDatasetId = null;

async function renderDataExplorer(container) {
  const d = await api('/datasets');

  container.innerHTML = `
    <h1>Data Explorer</h1>
    <p class="page-sub">Upload any spreadsheet — columns are auto-detected and charted automatically, no fixed format required.</p>

    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <h3 style="margin:0;">Upload Any Dataset</h3>
        <label class="upload-btn" style="cursor:pointer;">
          ⬆ Upload File (CSV / Excel)
          <input type="file" id="dataset-upload-input" accept=".csv,.xlsx,.xls" hidden />
        </label>
      </div>
      <p class="muted" style="margin:0;font-size:13px;">
        Any column names work. Dates become trend charts, numbers get summarized, and text/category
        columns become breakdown charts automatically.
      </p>
    </div>

    <div class="panel">
      <h3>Your Datasets</h3>
      ${d.datasets.length === 0 ? '<div class="empty-state">No datasets uploaded yet.</div>' : d.datasets.map(ds => `
        <div class="report-row">
          <div>
            <h4>${escapeHtml(ds.name)}</h4>
            <p>${num(ds.row_count)} rows · ${ds.columns_schema.length} columns · uploaded ${ds.uploaded_at}</p>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn-secondary" onclick="viewDataset(${ds.id})">View</button>
            <button class="btn-secondary" onclick="deleteDataset(${ds.id})">Delete</button>
          </div>
        </div>
      `).join('')}
    </div>

    <div id="dataset-view"></div>
  `;

  document.getElementById('dataset-upload-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const result = await api('/datasets/upload', { method: 'POST', body: formData });
      showToast(`Uploaded! Detected ${result.columns.length} columns across ${result.rowsImported} rows.`);
      viewingDatasetId = result.datasetId;
      navigate('data-explorer', true);
    } catch (err) { showToast(err.message, true); }
    e.target.value = '';
  });

  if (viewingDatasetId) {
    await showDatasetView(viewingDatasetId);
  }
}

async function viewDataset(id) {
  viewingDatasetId = id;
  await showDatasetView(id);
}

async function showDatasetView(id, metric) {
  const view = document.getElementById('dataset-view');
  if (!view) return;
  view.innerHTML = '<div class="empty-state">Loading dataset...</div>';
  try {
    const q = metric ? `?metric=${encodeURIComponent(metric)}` : '';
    const d = await api(`/datasets/${id}${q}`);

    view.innerHTML = `
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h3 style="margin:0;">${escapeHtml(d.name)}</h3>
          ${d.availableMetrics.length > 1 ? `
            <select id="metric-select" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13.5px;">
              ${d.availableMetrics.map(m => `<option value="${escapeHtml(m)}" ${m === d.trendMetric ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
            </select>` : ''}
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
          ${d.schema.map(c => `<span class="tag">${escapeHtml(c.name)} <strong>(${c.type})</strong></span>`).join('')}
        </div>

        <div class="card-grid" style="grid-template-columns: repeat(${Math.min(4, Math.max(1, d.numericSummaries.length))}, 1fr);">
          ${d.numericSummaries.slice(0, 4).map(s => `
            <div class="mini-stat" style="flex-direction:column;align-items:flex-start;gap:4px;">
              <span class="mini-stat-label">${escapeHtml(s.column)} (sum)</span>
              <span class="mini-stat-value">${s.sum.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</span>
            </div>
          `).join('')}
        </div>
      </div>

      ${d.trend.length > 0 ? `
      <div class="panel">
        <h3>Trend: ${escapeHtml(d.trendMetric)} over time</h3>
        <div class="chart-container"><canvas id="chart-dataset-trend"></canvas></div>
      </div>` : ''}

      ${d.categoryBreakdowns.map((cb, i) => `
        <div class="panel">
          <h3>${escapeHtml(cb.column)} breakdown (by ${escapeHtml(cb.metric)})</h3>
          <div class="chart-container"><canvas id="chart-dataset-cat-${i}"></canvas></div>
        </div>
      `).join('')}
    `;

    if (d.availableMetrics.length > 1) {
      document.getElementById('metric-select').onchange = (e) => showDatasetView(id, e.target.value);
    }

    if (d.trend.length > 0) {
      destroyChart('dtrend');
      chartInstances['dtrend'] = new Chart(document.getElementById('chart-dataset-trend'), {
        type: 'line',
        data: { labels: d.trend.map(t => t.month), datasets: [{ label: d.trendMetric, data: d.trend.map(t => t.value), borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)', fill: true, tension: 0.3 }] },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });
    }

    d.categoryBreakdowns.forEach((cb, i) => {
      destroyChart('dcat' + i);
      chartInstances['dcat' + i] = new Chart(document.getElementById(`chart-dataset-cat-${i}`), {
        type: 'bar',
        data: { labels: cb.data.map(x => x.label), datasets: [{ label: cb.metric, data: cb.data.map(x => x.value), backgroundColor: '#16a34a' }] },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });
    });
  } catch (err) {
    view.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

async function deleteDataset(id) {
  try {
    await api('/datasets/' + id, { method: 'DELETE' });
    if (viewingDatasetId === id) viewingDatasetId = null;
    showToast('Dataset deleted.');
    navigate('data-explorer', true);
  } catch (err) { showToast(err.message, true); }
}

// ===== Init =====
(function init() {
  if (TOKEN && CURRENT_USER) {
    showApp();
    navigate(location.hash.replace('#', '') || 'dashboard');
  } else {
    showAuth();
  }
})();

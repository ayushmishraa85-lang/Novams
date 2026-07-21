const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const MAX_ROWS = 20000;

// ---- Generic CSV parser (preserves original header casing, handles quoted fields) ----
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  function parseLine(line) {
    const fields = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else cur += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { fields.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    fields.push(cur);
    return fields.map(f => f.trim());
  }
  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] !== undefined ? values[i] : ''; });
    return row;
  });
}

// ---- Column type inference ----
function looksLikeDate(v) {
  const s = String(v).trim();
  return /^\d{4}-\d{1,2}-\d{1,2}/.test(s) ||
         /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s) ||
         /^\d{1,2}-\d{1,2}-\d{2,4}$/.test(s) ||
         /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(s);
}

function inferColumnType(values) {
  const nonEmpty = values.map(v => (v === null || v === undefined) ? '' : String(v).trim()).filter(v => v !== '');
  if (nonEmpty.length === 0) return 'text';
  const dateRate = nonEmpty.filter(looksLikeDate).length / nonEmpty.length;
  if (dateRate > 0.6) return 'date';
  const numRate = nonEmpty.filter(v => v !== '' && !isNaN(Number(v))).length / nonEmpty.length;
  if (numRate > 0.7) return 'numeric';
  return 'text';
}

function buildSchema(rows) {
  if (rows.length === 0) return [];
  const columnNames = Object.keys(rows[0]);
  const sample = rows.slice(0, 500);
  return columnNames.map(name => {
    const values = sample.map(r => r[name]);
    const type = inferColumnType(values);
    let distinctCount = null;
    if (type === 'text') {
      distinctCount = new Set(sample.map(r => String(r[name]).trim()).filter(v => v !== '')).size;
    }
    return { name, type, isCategorical: type === 'text' && distinctCount !== null && distinctCount <= 30 && distinctCount < sample.length * 0.5 };
  });
}

function monthKeyFromValue(v) {
  const d = new Date(v);
  if (isNaN(d)) return null;
  const label = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
  return { sortKey: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label };
}

router.post('/upload', upload.single('file'), async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const filename = req.file.originalname;
    const isExcel = /\.xlsx?$/i.test(filename);
    let rows = [];

    if (isExcel) {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(firstSheet, { defval: null });
    } else {
      rows = parseCSV(req.file.buffer.toString('utf-8'));
    }

    if (rows.length === 0) {
      return res.status(400).json({ error: 'That file appears to be empty or could not be parsed.' });
    }
    if (rows.length > MAX_ROWS) {
      return res.status(400).json({ error: `That file has ${rows.length.toLocaleString()} rows, which is over the ${MAX_ROWS.toLocaleString()}-row limit for the flexible data explorer. Try a smaller export, or use the structured Sales CSV / Product Catalog uploads for large volumes.` });
    }

    const schema = buildSchema(rows);

    await client.query('BEGIN');
    const datasetResult = await client.query(
      `INSERT INTO datasets (user_id, name, row_count, columns_schema) VALUES ($1,$2,$3,$4) RETURNING id`,
      [req.dataOwnerId, filename, rows.length, JSON.stringify(schema)]
    );
    const datasetId = datasetResult.rows[0].id;

    for (const row of rows) {
      await client.query('INSERT INTO dataset_rows (dataset_id, row_data) VALUES ($1, $2)', [datasetId, JSON.stringify(row)]);
    }

    await client.query('COMMIT');
    res.json({ success: true, datasetId, rowsImported: rows.length, columns: schema });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to process that file.' });
  } finally {
    client.release();
  }
});

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, row_count, columns_schema, to_char(uploaded_at, 'YYYY-MM-DD HH24:MI') AS uploaded_at
       FROM datasets WHERE user_id = $1 ORDER BY uploaded_at DESC`,
      [req.dataOwnerId]
    );
    res.json({ datasets: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load datasets.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const datasetResult = await pool.query(
      'SELECT * FROM datasets WHERE id = $1 AND user_id = $2',
      [req.params.id, req.dataOwnerId]
    );
    if (datasetResult.rows.length === 0) return res.status(404).json({ error: 'Dataset not found.' });
    const dataset = datasetResult.rows[0];
    const schema = dataset.columns_schema;

    const rowsResult = await pool.query('SELECT row_data FROM dataset_rows WHERE dataset_id = $1', [req.params.id]);
    const rows = rowsResult.rows.map(r => r.row_data);

    const numericCols = schema.filter(c => c.type === 'numeric').map(c => c.name);
    const dateCols = schema.filter(c => c.type === 'date').map(c => c.name);
    const categoricalCols = schema.filter(c => c.isCategorical).map(c => c.name);

    const requestedMetric = req.query.metric;
    const primaryMetric = numericCols.includes(requestedMetric) ? requestedMetric : numericCols[0];

    // Numeric summaries (sum/avg/min/max) for every numeric column
    const numericSummaries = numericCols.map(col => {
      const values = rows.map(r => Number(r[col])).filter(v => !isNaN(v));
      const sum = values.reduce((s, v) => s + v, 0);
      return {
        column: col,
        sum, count: values.length,
        avg: values.length ? sum / values.length : 0,
        min: values.length ? Math.min(...values) : 0,
        max: values.length ? Math.max(...values) : 0
      };
    });

    // Trend over time (first date column x primary numeric metric)
    let trend = [];
    if (dateCols.length > 0 && primaryMetric) {
      const dateCol = dateCols[0];
      const map = {};
      rows.forEach(r => {
        const mk = monthKeyFromValue(r[dateCol]);
        if (!mk) return;
        const val = Number(r[primaryMetric]) || 0;
        if (!map[mk.sortKey]) map[mk.sortKey] = { label: mk.label, value: 0 };
        map[mk.sortKey].value += val;
      });
      trend = Object.keys(map).sort().map(k => ({ month: map[k].label, value: map[k].value }));
    }

    // Category breakdowns (each categorical column x primary numeric metric, or row count)
    const categoryBreakdowns = categoricalCols.slice(0, 4).map(col => {
      const map = {};
      rows.forEach(r => {
        const key = r[col] === null || r[col] === undefined || r[col] === '' ? '(blank)' : String(r[col]);
        if (!map[key]) map[key] = 0;
        map[key] += primaryMetric ? (Number(r[primaryMetric]) || 0) : 1;
      });
      const entries = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10);
      return { column: col, metric: primaryMetric || 'Row Count', data: entries.map(([label, value]) => ({ label, value })) };
    });

    res.json({
      id: dataset.id,
      name: dataset.name,
      rowCount: dataset.row_count,
      schema,
      numericSummaries,
      trend,
      trendMetric: primaryMetric,
      categoryBreakdowns,
      availableMetrics: numericCols
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load dataset.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM datasets WHERE id = $1 AND user_id = $2', [req.params.id, req.dataOwnerId]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete dataset.' });
  }
});

module.exports = router;

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const XLSX = require('xlsx');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// CSV is streamed line-by-line and batch-inserted, so it scales to millions of rows
// without holding the whole file in memory. Excel files must still be fully parsed
// in memory by the xlsx library, so they stay capped much lower to avoid crashing
// a typical free-tier server (~512MB RAM).
const CSV_MAX_ROWS = 2_000_000;
const EXCEL_MAX_ROWS = 100_000;
const BATCH_SIZE = 1000;

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => cb(null, `dataset-${Date.now()}-${Math.round(Math.random() * 1e9)}`)
  }),
  limits: { fileSize: 300 * 1024 * 1024 } // 300MB
});

// ---- Line-level CSV parsing (handles quoted fields with commas) ----
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

// ---- Column type inference (based on a sample of rows) ----
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
function buildSchema(sampleRows) {
  if (sampleRows.length === 0) return [];
  const columnNames = Object.keys(sampleRows[0]);
  return columnNames.map(name => {
    const values = sampleRows.map(r => r[name]);
    const type = inferColumnType(values);
    let distinctCount = null;
    if (type === 'text') distinctCount = new Set(sampleRows.map(r => String(r[name]).trim()).filter(v => v !== '')).size;
    return { name, type, isCategorical: type === 'text' && distinctCount !== null && distinctCount <= 30 && distinctCount < sampleRows.length * 0.5 };
  });
}

// ---- Efficient batch insert (one round-trip per batch instead of per row) ----
async function insertBatch(client, datasetId, rows) {
  if (rows.length === 0) return;
  const valuesSql = [];
  const params = [];
  rows.forEach((row) => {
    params.push(datasetId, JSON.stringify(row));
    valuesSql.push(`($${params.length - 1}, $${params.length})`);
  });
  await client.query(`INSERT INTO dataset_rows (dataset_id, row_data) VALUES ${valuesSql.join(',')}`, params);
}

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const filePath = req.file.path;
  const isExcel = /\.xlsx?$/i.test(req.file.originalname);
  const client = await pool.connect();

  try {
    let datasetId;

    if (isExcel) {
      const workbook = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: null });

      if (rows.length === 0) return res.status(400).json({ error: 'That file appears to be empty or could not be parsed.' });
      if (rows.length > EXCEL_MAX_ROWS) {
        return res.status(400).json({ error: `Excel files are limited to ${EXCEL_MAX_ROWS.toLocaleString()} rows (yours has ${rows.length.toLocaleString()}) because they must be fully loaded into memory. For larger volumes, export as CSV instead - CSV supports up to ${CSV_MAX_ROWS.toLocaleString()} rows.` });
      }

      const schema = buildSchema(rows.slice(0, 500));
      await client.query('BEGIN');
      const dsResult = await client.query(
        `INSERT INTO datasets (user_id, name, row_count, columns_schema) VALUES ($1,$2,$3,$4) RETURNING id`,
        [req.dataOwnerId, req.file.originalname, rows.length, JSON.stringify(schema)]
      );
      datasetId = dsResult.rows[0].id;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        await insertBatch(client, datasetId, rows.slice(i, i + BATCH_SIZE));
      }
      await client.query('COMMIT');
      return res.json({ success: true, datasetId, rowsImported: rows.length, columns: schema });
    }

    // ---- CSV: stream line-by-line, never holding the whole file in memory ----
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let headers = null;
    let sampleRows = [];
    let batch = [];
    let rowCount = 0;
    let isFirstLine = true;
    let datasetCreated = false;

    await client.query('BEGIN');

    for await (const rawLine of rl) {
      let line = rawLine;
      if (isFirstLine && line.charCodeAt(0) === 0xFEFF) line = line.slice(1); // strip Excel BOM
      if (line.trim().length === 0) continue;

      if (isFirstLine) {
        headers = parseLine(line);
        isFirstLine = false;
        continue;
      }

      const values = parseLine(line);
      const row = {};
      headers.forEach((h, i) => { row[h] = values[i] !== undefined ? values[i] : ''; });

      rowCount++;
      if (rowCount > CSV_MAX_ROWS) {
        await client.query('ROLLBACK');
        rl.close();
        fs.unlink(filePath, () => {});
        return res.status(400).json({ error: `That file has more than ${CSV_MAX_ROWS.toLocaleString()} rows, which is over the current limit. Try splitting it into smaller files.` });
      }

      if (sampleRows.length < 500) sampleRows.push(row);
      batch.push(row);

      if (!datasetCreated) {
        // Create the dataset record as soon as we have a first batch's worth of sample data,
        // so schema inference has something to work with; row_count is finalized at the end.
        if (batch.length >= 500 || rowCount === 1) {
          const schema = buildSchema(sampleRows);
          const dsResult = await client.query(
            `INSERT INTO datasets (user_id, name, row_count, columns_schema) VALUES ($1,$2,0,$3) RETURNING id`,
            [req.dataOwnerId, req.file.originalname, JSON.stringify(schema)]
          );
          datasetId = dsResult.rows[0].id;
          datasetCreated = true;
        }
      }

      if (batch.length >= BATCH_SIZE) {
        if (datasetCreated) {
          await insertBatch(client, datasetId, batch);
        }
        batch = [];
      }
    }

    if (!datasetCreated) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'That file appears to be empty or could not be parsed.' });
    }
    if (batch.length > 0) await insertBatch(client, datasetId, batch);

    const finalSchema = buildSchema(sampleRows);
    await client.query('UPDATE datasets SET row_count = $1, columns_schema = $2 WHERE id = $3', [rowCount, JSON.stringify(finalSchema), datasetId]);

    await client.query('COMMIT');
    res.json({ success: true, datasetId, rowsImported: rowCount, columns: finalSchema });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'Failed to process that file.' });
  } finally {
    client.release();
    fs.unlink(filePath, () => {});
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

// All aggregation below runs as SQL against PostgreSQL directly - it never pulls
// the full row set into Node memory, so this scales to millions of rows. Column
// names are always passed as bound parameters (never string-interpolated into the
// SQL text), so this is safe even though column names come from user-uploaded files.
router.get('/:id', async (req, res) => {
  try {
    const datasetResult = await pool.query('SELECT * FROM datasets WHERE id = $1 AND user_id = $2', [req.params.id, req.dataOwnerId]);
    if (datasetResult.rows.length === 0) return res.status(404).json({ error: 'Dataset not found.' });
    const dataset = datasetResult.rows[0];
    const schema = dataset.columns_schema;
    const datasetId = dataset.id;

    const numericCols = schema.filter(c => c.type === 'numeric').map(c => c.name);
    const dateCols = schema.filter(c => c.type === 'date').map(c => c.name);
    const categoricalCols = schema.filter(c => c.isCategorical).map(c => c.name);
    const NUMERIC_PATTERN = '^\\s*-?[0-9]+(\\.[0-9]+)?\\s*$';

    const requestedMetric = req.query.metric;
    const primaryMetric = numericCols.includes(requestedMetric) ? requestedMetric : numericCols[0];

    const numericSummaries = [];
    for (const col of numericCols) {
      const r = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE row_data->>$1 ~ $3) AS cnt,
           COALESCE(SUM((row_data->>$1)::numeric) FILTER (WHERE row_data->>$1 ~ $3), 0) AS sum,
           COALESCE(AVG((row_data->>$1)::numeric) FILTER (WHERE row_data->>$1 ~ $3), 0) AS avg,
           MIN((row_data->>$1)::numeric) FILTER (WHERE row_data->>$1 ~ $3) AS min,
           MAX((row_data->>$1)::numeric) FILTER (WHERE row_data->>$1 ~ $3) AS max
         FROM dataset_rows WHERE dataset_id = $2`,
        [col, datasetId, NUMERIC_PATTERN]
      );
      const row = r.rows[0];
      numericSummaries.push({
        column: col, sum: Number(row.sum), count: Number(row.cnt),
        avg: Number(row.avg), min: Number(row.min) || 0, max: Number(row.max) || 0
      });
    }

    let trend = [];
    if (dateCols.length > 0 && primaryMetric) {
      const dateCol = dateCols[0];
      const r = await pool.query(
        `SELECT to_char(date_trunc('month', (row_data->>$1)::date), 'Mon YYYY') AS label,
                date_trunc('month', (row_data->>$1)::date) AS sort_key,
                COALESCE(SUM((row_data->>$2)::numeric) FILTER (WHERE row_data->>$2 ~ $4), 0) AS value
         FROM dataset_rows
         WHERE dataset_id = $3 AND row_data->>$1 ~ '^\\d{4}-\\d{1,2}-\\d{1,2}'
         GROUP BY 1, 2 ORDER BY 2`,
        [dateCol, primaryMetric, datasetId, NUMERIC_PATTERN]
      ).catch(() => ({ rows: [] })); // tolerate unparseable dates rather than failing the whole page
      trend = r.rows.map(row => ({ month: row.label, value: Number(row.value) }));
    }

    const categoryBreakdowns = [];
    for (const col of categoricalCols.slice(0, 4)) {
      const r = await pool.query(
        primaryMetric
          ? `SELECT COALESCE(NULLIF(row_data->>$1, ''), '(blank)') AS label,
                    COALESCE(SUM((row_data->>$2)::numeric) FILTER (WHERE row_data->>$2 ~ $4), 0) AS value
             FROM dataset_rows WHERE dataset_id = $3
             GROUP BY 1 ORDER BY 2 DESC LIMIT 10`
          : `SELECT COALESCE(NULLIF(row_data->>$1, ''), '(blank)') AS label, COUNT(*) AS value
             FROM dataset_rows WHERE dataset_id = $3
             GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        primaryMetric ? [col, primaryMetric, datasetId, NUMERIC_PATTERN] : [col, null, datasetId, null]
      );
      categoryBreakdowns.push({ column: col, metric: primaryMetric || 'Row Count', data: r.rows.map(row => ({ label: row.label, value: Number(row.value) })) });
    }

    res.json({
      id: dataset.id, name: dataset.name, rowCount: dataset.row_count, schema,
      numericSummaries, trend, trendMetric: primaryMetric, categoryBreakdowns, availableMetrics: numericCols
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

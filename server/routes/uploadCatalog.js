const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Column names as they appear in the Zepto-style catalog export. Each sheet in the
// workbook is treated as a product category (e.g. "Fruits & Vegetables", "Beverages").
// Prices in the source file are in paise (1/100 rupee) and are converted to decimal here.
router.post('/', upload.single('file'), async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    } catch (e) {
      return res.status(400).json({ error: 'Could not read that file. Please upload a valid .xlsx workbook.' });
    }

    if (workbook.SheetNames.length === 0) {
      return res.status(400).json({ error: 'The workbook has no sheets.' });
    }

    await client.query('BEGIN');
    let imported = 0;
    let skippedSheets = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
      if (rows.length === 0) continue;

      const sampleKeys = Object.keys(rows[0]).map(k => k.toLowerCase());
      if (!sampleKeys.includes('name')) {
        skippedSheets.push(sheetName);
        continue;
      }

      for (const row of rows) {
        const norm = {};
        Object.keys(row).forEach(k => { norm[k.trim().toLowerCase()] = row[k]; });

        const name = norm.name ? String(norm.name).trim() : null;
        if (!name) continue;

        const mrp = norm.mrp != null ? Number(norm.mrp) / 100 : null;
        const discountedPrice = norm.discountedsellingprice != null ? Number(norm.discountedsellingprice) / 100 : null;
        const discountPercent = norm.discountpercent != null ? Number(norm.discountpercent) : null;
        const availableQty = norm.availablequantity != null ? parseInt(norm.availablequantity, 10) : 0;
        const weightInGms = norm.weightingms != null ? Number(norm.weightingms) : null;
        const outOfStock = norm.outofstock === true || String(norm.outofstock).toLowerCase() === 'true';
        const packQuantity = norm.quantity != null ? parseInt(norm.quantity, 10) : null;

        await client.query(
          `INSERT INTO products (user_id, name, category, price, stock, mrp, discount_percent, weight_in_gms, out_of_stock, pack_quantity)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (user_id, name) DO UPDATE SET
             category = EXCLUDED.category,
             price = EXCLUDED.price,
             stock = EXCLUDED.stock,
             mrp = EXCLUDED.mrp,
             discount_percent = EXCLUDED.discount_percent,
             weight_in_gms = EXCLUDED.weight_in_gms,
             out_of_stock = EXCLUDED.out_of_stock,
             pack_quantity = EXCLUDED.pack_quantity`,
          [req.dataOwnerId, name, sheetName, discountedPrice, availableQty, mrp, discountPercent, weightInGms, outOfStock, packQuantity]
        );
        imported++;
      }
    }

    await client.query(
      'INSERT INTO uploads (user_id, filename, rows_imported) VALUES ($1,$2,$3)',
      [req.dataOwnerId, req.file.originalname, imported]
    );

    await client.query('COMMIT');
    res.json({ success: true, rowsImported: imported, sheetsProcessed: workbook.SheetNames.length - skippedSheets.length, skippedSheets });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to process the catalog upload.' });
  } finally {
    client.release();
  }
});

module.exports = router;

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3421;
const DB_PATH = path.join(__dirname, 'db.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Migrate old format to new format on startup
function migrate(db) {
  let changed = false;

  // bills -> templates
  if (db.bills && !db.templates) {
    db.templates = db.bills;
    delete db.bills;
    changed = true;
  }
  if (!db.templates) { db.templates = []; changed = true; }
  if (!db.monthlyData) { db.monthlyData = {}; changed = true; }

  // Convert old settled-array format -> bills array with settled field
  for (const [month, data] of Object.entries(db.monthlyData)) {
    if (Array.isArray(data.settled) && !data.bills) {
      const settledSet = new Set(data.settled);
      data.bills = db.templates.map(t => ({
        ...t,
        id: crypto.randomUUID(),
        settled: settledSet.has(t.id)
      }));
      delete data.settled;
      changed = true;
    }
    if (!data.bills) { data.bills = []; }
  }

  return changed;
}

{
  const db = readDB();
  if (migrate(db)) {
    writeDB(db);
    console.log('Database migrated to per-month bill format.');
  }
}

// ── Data ──────────────────────────────────────────────────────────────────────

app.get('/api/data', (req, res) => res.json(readDB()));

app.put('/api/settings', (req, res) => {
  const db = readDB();
  db.settings = { ...db.settings, ...req.body };
  writeDB(db);
  res.json(db.settings);
});

// ── Templates ─────────────────────────────────────────────────────────────────

app.post('/api/templates', (req, res) => {
  const db = readDB();
  const tmpl = {
    id: crypto.randomUUID(),
    name: req.body.name,
    amount: parseFloat(req.body.amount),
    owner: req.body.owner,
    splitType: req.body.splitType,
    partner1Percent: req.body.splitType === 'utility' ? (req.body.partner1Percent ?? 55) : 50,
    notes: req.body.notes || ''
  };
  db.templates.push(tmpl);
  writeDB(db);
  res.json(tmpl);
});

app.put('/api/templates/:id', (req, res) => {
  const db = readDB();
  const idx = db.templates.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.templates[idx] = { ...db.templates[idx], ...req.body };
  if (req.body.splitType === 'subscription') db.templates[idx].partner1Percent = 50;
  writeDB(db);
  res.json(db.templates[idx]);
});

app.delete('/api/templates/:id', (req, res) => {
  const db = readDB();
  db.templates = db.templates.filter(t => t.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ── Monthly Bills ─────────────────────────────────────────────────────────────

function ensureMonth(db, month) {
  if (!db.monthlyData[month]) db.monthlyData[month] = { bills: [] };
  if (!db.monthlyData[month].bills) db.monthlyData[month].bills = [];
}

// Seed a month from templates
app.post('/api/months/:month/init', (req, res) => {
  const db = readDB();
  const { month } = req.params;
  ensureMonth(db, month);
  db.monthlyData[month].bills = db.templates.map(t => ({
    ...t,
    id: crypto.randomUUID(),
    settled: false
  }));
  writeDB(db);
  res.json(db.monthlyData[month]);
});

// Add a bill to a month
app.post('/api/months/:month/bills', (req, res) => {
  const db = readDB();
  const { month } = req.params;
  ensureMonth(db, month);
  const bill = {
    id: crypto.randomUUID(),
    name: req.body.name,
    amount: parseFloat(req.body.amount),
    owner: req.body.owner,
    splitType: req.body.splitType,
    partner1Percent: req.body.splitType === 'utility' ? (req.body.partner1Percent ?? 55) : 50,
    notes: req.body.notes || '',
    settled: false
  };
  db.monthlyData[month].bills.push(bill);
  writeDB(db);
  res.json(bill);
});

// Update a monthly bill (amount, settle toggle, split, etc.)
app.put('/api/months/:month/bills/:id', (req, res) => {
  const db = readDB();
  const { month, id } = req.params;
  ensureMonth(db, month);
  const idx = db.monthlyData[month].bills.findIndex(b => b.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.monthlyData[month].bills[idx] = { ...db.monthlyData[month].bills[idx], ...req.body };
  if (req.body.splitType === 'subscription') db.monthlyData[month].bills[idx].partner1Percent = 50;
  writeDB(db);
  res.json(db.monthlyData[month].bills[idx]);
});

// Delete a monthly bill
app.delete('/api/months/:month/bills/:id', (req, res) => {
  const db = readDB();
  const { month } = req.params;
  ensureMonth(db, month);
  db.monthlyData[month].bills = db.monthlyData[month].bills.filter(b => b.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// Mark all bills in a month as settled
app.put('/api/months/:month/settle-all', (req, res) => {
  const db = readDB();
  const { month } = req.params;
  ensureMonth(db, month);
  db.monthlyData[month].bills.forEach(b => { b.settled = true; });
  writeDB(db);
  res.json(db.monthlyData[month]);
});

app.listen(PORT, () => {
  console.log(`Bill Calc running at http://localhost:${PORT}`);
});

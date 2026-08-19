require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const { waitForDb, query } = require('./db');
const { attachUser } = require('./auth');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(attachUser);

/* ---------- API ---------- */
const api = express.Router();
api.use(require('./routes/auth'));
api.use(require('./routes/content'));
api.use(require('./routes/quiz'));
api.use(require('./routes/assets'));
api.use(require('./routes/progress'));
api.use(require('./routes/backup'));
api.use(require('./routes/content-export'));
api.use(require('./routes/export'));
api.get('/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', db: 'up', time: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ status: 'degraded', db: 'down', error: e.message });
  }
});
app.use('/api', api);

/* ---------- Static frontend ---------- */
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
app.get('/admin', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

/* ---------- Errors ---------- */
app.use((req, res) => res.status(404).json({ error: 'ไม่พบเส้นทางที่ร้องขอ', path: req.path }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  res.status(status).json({ error: err.message || 'เกิดข้อผิดพลาดภายในระบบ' });
});

(async () => {
  await waitForDb();

  // Apply schema on boot (idempotent)
  const schemaPath = path.join(__dirname, '..', '..', 'db', 'init.sql');
  if (fs.existsSync(schemaPath)) {
    await query(fs.readFileSync(schemaPath, 'utf8'));
    console.log('[db] schema applied');
  }

  if (process.env.AUTO_SEED !== 'false') {
    await require('../seed/seed').run();
  }

  require('./backup').startScheduler();

  app.listen(PORT, '0.0.0.0', () => console.log(`[server] listening on :${PORT}`));
})().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});

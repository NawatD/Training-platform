/* ============================================================
   Backup / Restore — in-app content backup
   - จับภาพฐานข้อมูล Postgres ทั้งหมด (JSON, gzip) + ไฟล์สื่อที่อัปโหลด
   - เก็บที่ BACKUP_DIR (แนะนำ mount เป็น volume แยก เช่น /data/backups)
   - backup อัตโนมัติ (type: auto) รันวันละครั้ง เก็บย้อนหลัง BACKUP_RETENTION_DAYS วัน
   - backup แบบกดเอง (type: manual) ไม่ถูกลบอัตโนมัติ — ลบเองได้จากหน้า Admin เท่านั้น
   ============================================================ */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { query, tx } = require('./db');
const { STORAGE_DIR } = require('./routes/assets');

const BACKUP_DIR = process.env.BACKUP_DIR || '/data/backups';
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '3', 10);
const AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000; // ระยะห่างระหว่าง auto backup แต่ละครั้ง
const CHECK_INTERVAL_MS = 60 * 60 * 1000;     // ความถี่ในการเช็คว่าถึงเวลา backup อัตโนมัติหรือยัง

fs.mkdirSync(BACKUP_DIR, { recursive: true });
const INDEX_FILE = path.join(BACKUP_DIR, 'index.json');

// ลำดับตารางสำคัญ — ต้อง insert ตามลำดับนี้ตอน restore เพื่อไม่ให้ FK พัง
// (users ก่อน domains/assets, modules ก่อน sections, ฯลฯ)
// jsonb: คอลัมน์ชนิด JSONB ต้อง JSON.stringify ก่อน insert เสมอ — pg แปลง JS array
// เป็น Postgres array literal ("{a,b,c}") ไม่ใช่ JSON โดยอัตโนมัติ ถ้าไม่ stringify เองจะ insert ไม่ผ่าน
const TABLES = [
  { name: 'users', columns: ['id', 'email', 'full_name', 'password_hash', 'role', 'is_active', 'created_at'], jsonb: [] },
  { name: 'domains', columns: ['id', 'slug', 'name', 'icon', 'description', 'status', 'sort_order', 'created_at', 'updated_at'], jsonb: [] },
  { name: 'modules', columns: ['id', 'domain_id', 'code', 'title', 'summary', 'level', 'duration', 'key_terms', 'is_published', 'sort_order', 'created_at', 'updated_at', 'updated_by'], jsonb: ['key_terms'] },
  { name: 'assets', columns: ['id', 'filename', 'original_name', 'mime_type', 'size_bytes', 'kind', 'uploaded_by', 'created_at'], jsonb: [] },
  { name: 'sections', columns: ['id', 'module_id', 'heading', 'kind', 'body', 'asset_id', 'sort_order', 'created_at', 'updated_at', 'updated_by'], jsonb: [] },
  { name: 'quiz_questions', columns: ['id', 'domain_id', 'module_id', 'level', 'category', 'question', 'options', 'correct_index', 'explanation', 'is_active', 'sort_order', 'created_at', 'updated_at', 'updated_by'], jsonb: ['options'] },
  { name: 'module_progress', columns: ['user_id', 'module_id', 'completed', 'completed_at'], jsonb: [] },
  { name: 'quiz_attempts', columns: ['id', 'user_id', 'domain_id', 'score', 'total', 'percent', 'breakdown', 'answers', 'created_at'], jsonb: ['breakdown', 'answers'] },
];
const TABLE_NAMES = TABLES.map((t) => t.name);

/* ---------- index.json (manifest) ---------- */
function readIndex() {
  if (!fs.existsSync(INDEX_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch (_) { return []; }
}
function writeIndex(list) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(list, null, 2));
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

function newId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${crypto.randomBytes(2).toString('hex')}`;
}

function removeBackupDir(id) {
  fs.rmSync(path.join(BACKUP_DIR, id), { recursive: true, force: true });
}

/* ---------- create ---------- */
async function createBackup(type = 'manual', label = null) {
  const id = newId();
  const dir = path.join(BACKUP_DIR, id);
  const mediaDir = path.join(dir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  const dump = { schemaVersion: 1, createdAt: new Date().toISOString(), tables: {} };
  for (const t of TABLES) {
    const { rows } = await query(`SELECT ${t.columns.join(',')} FROM ${t.name}`);
    dump.tables[t.name] = rows;
  }
  fs.writeFileSync(path.join(dir, 'data.json.gz'), zlib.gzipSync(JSON.stringify(dump)));

  // คัดลอกไฟล์สื่อที่ assets อ้างถึง ณ เวลา backup
  let mediaCount = 0;
  let mediaMissing = 0;
  for (const a of dump.tables.assets) {
    try {
      fs.copyFileSync(path.join(STORAGE_DIR, a.filename), path.join(mediaDir, a.filename));
      mediaCount++;
    } catch (_) {
      mediaMissing++; // ไฟล์หายไปจากดิสก์แล้ว แต่ยังมี metadata อยู่ — ข้ามไป ไม่ทำให้ backup ทั้งชุดล้มเหลว
    }
  }

  const entry = {
    id,
    type, // 'manual' | 'auto'
    label,
    createdAt: dump.createdAt,
    tableCounts: Object.fromEntries(TABLES.map((t) => [t.name, dump.tables[t.name].length])),
    mediaCount,
    mediaMissing,
    sizeBytes: dirSize(dir),
    status: 'ok',
  };
  const list = readIndex();
  list.push(entry);
  writeIndex(list);

  if (type === 'auto') await pruneOldBackups();
  return entry;
}

/* ---------- list / delete / prune ---------- */
async function listBackups() {
  return readIndex().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function deleteBackup(id) {
  const list = readIndex();
  const next = list.filter((b) => b.id !== id);
  if (next.length === list.length) throw new Error('ไม่พบ backup นี้');
  removeBackupDir(id);
  writeIndex(next);
}

// ลบเฉพาะ backup อัตโนมัติ (type: 'auto') ที่เก่ากว่า RETENTION_DAYS วัน
// backup แบบ manual จะไม่ถูกลบโดยอัตโนมัติเด็ดขาด
async function pruneOldBackups() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const list = readIndex();
  const keep = [];
  let removed = 0;
  for (const b of list) {
    if (b.type === 'auto' && new Date(b.createdAt).getTime() < cutoff) {
      removeBackupDir(b.id);
      removed++;
    } else {
      keep.push(b);
    }
  }
  if (removed) writeIndex(keep);
  return removed;
}

/* ---------- restore ---------- */
async function restoreBackup(id) {
  const dir = path.join(BACKUP_DIR, id);
  const dataFile = path.join(dir, 'data.json.gz');
  if (!fs.existsSync(dataFile)) throw new Error('ไม่พบไฟล์ backup นี้');
  const dump = JSON.parse(zlib.gunzipSync(fs.readFileSync(dataFile)).toString('utf8'));

  await tx(async (c) => {
    await c.query(`TRUNCATE TABLE ${TABLE_NAMES.join(', ')} CASCADE`);
    for (const t of TABLES) {
      const rows = dump.tables[t.name] || [];
      if (!rows.length) continue;
      const placeholders = t.columns.map((_, i) => `$${i + 1}`).join(',');
      const sql = `INSERT INTO ${t.name} (${t.columns.join(',')}) VALUES (${placeholders})`;
      for (const row of rows) {
        const values = t.columns.map((col) => {
          const v = row[col];
          return t.jsonb.includes(col) && v != null ? JSON.stringify(v) : v;
        });
        await c.query(sql, values);
      }
    }
  });

  // กู้คืนไฟล์สื่อ (คัดลอกทับ ไม่ลบไฟล์อื่นที่มีอยู่ใน storage เพื่อความปลอดภัย)
  const mediaDir = path.join(dir, 'media');
  let restoredFiles = 0;
  if (fs.existsSync(mediaDir)) {
    for (const f of fs.readdirSync(mediaDir)) {
      try {
        fs.copyFileSync(path.join(mediaDir, f), path.join(STORAGE_DIR, f));
        restoredFiles++;
      } catch (_) { /* ข้ามไฟล์ที่คัดลอกไม่ได้ */ }
    }
  }

  return {
    id,
    restoredFiles,
    tables: Object.fromEntries(TABLES.map((t) => [t.name, (dump.tables[t.name] || []).length])),
  };
}

/* ---------- scheduler ---------- */
let schedulerStarted = false;
function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const maybeRunAuto = async () => {
    try {
      const list = readIndex();
      const lastAuto = list
        .filter((b) => b.type === 'auto')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const due = !lastAuto || (Date.now() - new Date(lastAuto.createdAt).getTime()) >= AUTO_INTERVAL_MS;
      if (due) {
        console.log('[backup] running scheduled auto backup...');
        const entry = await createBackup('auto');
        console.log(`[backup] auto backup done: ${entry.id} (${entry.sizeBytes} bytes)`);
      } else {
        await pruneOldBackups();
      }
    } catch (e) {
      console.error('[backup] scheduled run failed:', e.message);
    }
  };

  maybeRunAuto();
  setInterval(maybeRunAuto, CHECK_INTERVAL_MS);
}

module.exports = {
  createBackup, listBackups, deleteBackup, pruneOldBackups, restoreBackup, startScheduler,
  BACKUP_DIR, RETENTION_DAYS,
};

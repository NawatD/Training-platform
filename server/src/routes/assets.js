const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { query } = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();

const STORAGE_DIR = process.env.STORAGE_DIR || '/data/storage';
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || '2048', 10);

const ALLOWED = {
  // video
  'video/mp4': 'video', 'video/webm': 'video', 'video/ogg': 'video', 'video/quicktime': 'video',
  // slides
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'slide',
  'application/vnd.ms-powerpoint': 'slide',
  'application/vnd.oasis.opendocument.presentation': 'slide',
  // documents
  'application/pdf': 'pdf',
  // images
  'image/png': 'image', 'image/jpeg': 'image', 'image/gif': 'image', 'image/webp': 'image', 'image/svg+xml': 'image',
  // เนื้อหา HTML ที่เขียน/แก้ไว้นอกระบบแล้วอัปโหลดเข้ามาแนบกับหัวข้อ kind=html แทนการพิมพ์ในกล่องข้อความ
  'text/html': 'html',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, STORAGE_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 12);
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // multer/busboy ถอดชื่อไฟล์จาก multipart header เป็น latin1 เสมอ (ตามสเปก) แต่เบราว์เซอร์ส่งเป็น UTF-8 จริง
    // ถ้าไม่แปลงกลับ ชื่อไฟล์ภาษาไทย/ภาษาอื่นที่ไม่ใช่ ASCII จะเพี้ยน (mojibake) — แปลงก่อนใช้งานเสมอ
    // (ปลอดภัยกับชื่อไฟล์ภาษาอังกฤษด้วย เพราะ ASCII ใน latin1 กับ utf8 เหมือนกัน)
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    if (!ALLOWED[file.mimetype]) {
      return cb(new Error(`ไม่รองรับไฟล์ประเภท ${file.mimetype}`));
    }
    cb(null, true);
  },
});

/* ---------- Upload ---------- */
router.post('/assets', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์ที่อัปโหลด' });
  const kind = ALLOWED[req.file.mimetype] || 'other';
  const { rows } = await query(
    `INSERT INTO assets (filename, original_name, mime_type, size_bytes, kind, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, kind, req.user.sub]
  );
  res.status(201).json(rows[0]);
});

/* ---------- List ---------- */
router.get('/assets', requireAdmin, async (req, res) => {
  const { kind } = req.query;
  const { rows } = await query(
    `SELECT a.*, u.full_name AS uploader
       FROM assets a LEFT JOIN users u ON u.id = a.uploaded_by
      ${kind ? 'WHERE a.kind=$1' : ''}
      ORDER BY a.created_at DESC`,
    kind ? [kind] : []
  );
  res.json(rows);
});

/* ---------- Stream / download (supports HTTP Range for video seeking) ---------- */
router.get('/assets/:id/file', async (req, res) => {
  const { rows } = await query('SELECT * FROM assets WHERE id=$1', [req.params.id]);
  const asset = rows[0];
  if (!asset) return res.status(404).json({ error: 'ไม่พบไฟล์' });

  const filePath = path.join(STORAGE_DIR, asset.filename);
  if (!fs.existsSync(filePath)) return res.status(410).json({ error: 'ไฟล์หายไปจากที่จัดเก็บ' });

  const stat = fs.statSync(filePath);
  const range = req.headers.range;

  res.setHeader('Content-Type', asset.mime_type);
  res.setHeader('Accept-Ranges', 'bytes');
  if (req.query.download === '1') {
    res.setHeader('Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(asset.original_name)}`);
  }

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (start >= stat.size || end >= stat.size || start > end) {
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', end - start + 1);
    return fs.createReadStream(filePath, { start, end }).pipe(res);
  }

  res.setHeader('Content-Length', stat.size);
  fs.createReadStream(filePath).pipe(res);
});

/* ---------- Delete ---------- */
router.delete('/assets/:id', requireAdmin, async (req, res) => {
  const { rows } = await query('DELETE FROM assets WHERE id=$1 RETURNING filename', [req.params.id]);
  if (rows[0]) {
    const p = path.join(STORAGE_DIR, rows[0].filename);
    fs.promises.unlink(p).catch(() => {});
  }
  res.json({ ok: true });
});

module.exports = router;
module.exports.STORAGE_DIR = STORAGE_DIR;

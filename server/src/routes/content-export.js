const express = require('express');
const multer = require('multer');
const { requireAdmin } = require('../auth');
const ce = require('../content-export');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

/* ---------- Export ---------- */
router.get('/content-export/export', requireAdmin, async (req, res) => {
  const domain = req.query.domain || null;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const wb = await ce.buildWorkbook(domain, baseUrl);
  const filename = `training-content${domain ? '-' + domain : ''}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  await wb.xlsx.write(res);
  res.end();
});

/* ---------- Import: preview (upload + validate + diff, ยังไม่เขียนอะไร) ---------- */
router.post('/content-export/import/preview', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์ที่อัปโหลด' });
  const result = await ce.previewImport(req.file.buffer);
  if (result.errors) return res.status(422).json({ errors: result.errors });
  res.json(result);
});

/* ---------- Import: commit (apply การเปลี่ยนแปลงจริง) ---------- */
router.post('/content-export/import/commit', requireAdmin, async (req, res) => {
  const token = req.body && req.body.token;
  if (!token) return res.status(400).json({ error: 'ไม่พบ token — กรุณาอัปโหลดไฟล์ใหม่' });
  try {
    const summary = await ce.commitImport(token, req.user.sub);
    res.json({ ok: true, summary });
  } catch (e) {
    if (e.errors) return res.status(422).json({ errors: e.errors });
    throw e;
  }
});

/* ---------- Import: discard (ยกเลิกไฟล์ที่รออยู่) ---------- */
router.post('/content-export/import/discard', requireAdmin, async (req, res) => {
  const token = req.body && req.body.token;
  if (token) ce.discardTokenFile(token);
  res.json({ ok: true });
});

module.exports = router;

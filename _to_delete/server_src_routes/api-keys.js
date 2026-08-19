/* ============================================================
   จัดการ API key สำหรับระบบภายนอก (admin เท่านั้น)
   สร้าง/ดูรายการ/ยกเลิก — คีย์เต็มโชว์ "ครั้งเดียว" ตอนสร้างเท่านั้น หลังจากนั้นดูคีย์เต็มไม่ได้อีก
   ============================================================ */
const express = require('express');
const { query } = require('../db');
const { requireAdmin } = require('../auth');
const { generateApiKey, hashApiKey, DISPLAY_PREFIX_LEN } = require('../api-keys');

const router = express.Router();

/* ---------- List ---------- */
router.get('/api-keys', requireAdmin, async (req, res) => {
  const { rows } = await query(
    `SELECT ak.id, ak.name, ak.key_prefix, ak.is_active, ak.created_at, ak.last_used_at, ak.revoked_at,
            u.full_name AS created_by_name
       FROM api_keys ak
       LEFT JOIN users u ON u.id = ak.created_by
      ORDER BY ak.created_at DESC`
  );
  res.json(rows);
});

/* ---------- Create ---------- */
router.post('/api-keys', requireAdmin, async (req, res) => {
  const name = (req.body && req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'ต้องระบุชื่อ (เช่น ชื่อระบบ/พาร์ทเนอร์ที่ขอคีย์นี้)' });

  const key = generateApiKey();
  const keyPrefix = key.slice(0, DISPLAY_PREFIX_LEN);

  const { rows } = await query(
    `INSERT INTO api_keys (name, key_prefix, key_hash, created_by)
     VALUES ($1,$2,$3,$4)
     RETURNING id, name, key_prefix, is_active, created_at`,
    [name, keyPrefix, hashApiKey(key), req.user.sub]
  );
  // key เต็มคืนกลับตรงนี้ที่เดียว — เก็บไว้เฉพาะ hash ใน DB ตั้งแต่บรรทัดบน ดูคีย์เต็มซ้ำอีกไม่ได้แล้ว
  res.status(201).json({ ...rows[0], key });
});

/* ---------- Revoke (ไม่ลบแถวออก — เก็บไว้เป็นประวัติการใช้งาน) ---------- */
router.delete('/api-keys/:id', requireAdmin, async (req, res) => {
  const { rows } = await query(
    `UPDATE api_keys SET is_active = FALSE, revoked_at = now()
      WHERE id = $1 RETURNING id`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'ไม่พบ API key นี้' });
  res.json({ ok: true });
});

module.exports = router;

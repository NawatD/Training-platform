/* ============================================================
   API key — auth แบบ "คีย์เดียวคงที่" สำหรับระบบภายนอกที่จะมาเรียก /api/export/*
   ตั้งค่าที่ env var EXPORT_API_KEY (ดู .env.example) — ไม่มี DB, ไม่มีหลายคีย์/revoke
   ถ้าต้องแจกคีย์แยกให้แต่ละพาร์ทเนอร์ หรืออยากยกเลิกคีย์ใดคีย์หนึ่งได้โดยไม่กระทบคนอื่น
   ค่อยเปลี่ยนไปเก็บใน DB ทีหลังได้ — ตอนนี้เลือกแบบง่ายสุดตามที่ต้องการก่อน
   ============================================================ */
const crypto = require('crypto');

// เทียบแบบ timing-safe กันโดน timing attack เดาคีย์ทีละตัวอักษร (ถึงจะโอกาสน้อยมากสำหรับ use case นี้ก็ตาม)
function safeEqual(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Middleware สำหรับเส้นทางที่ให้ "ระบบภายนอก" เรียก — ต้องส่ง header X-API-Key มาด้วยทุกครั้ง
function requireApiKey(req, res, next) {
  const configuredKey = process.env.EXPORT_API_KEY;
  if (!configuredKey) {
    console.error('[api-keys] ยังไม่ได้ตั้งค่า EXPORT_API_KEY — ปิดใช้งาน /api/export ไว้ก่อนจนกว่าจะตั้งค่า');
    return res.status(500).json({ error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า EXPORT_API_KEY' });
  }

  const key = req.headers['x-api-key'];
  if (!key || typeof key !== 'string') {
    return res.status(401).json({ error: 'ต้องระบุ API key ผ่าน header X-API-Key' });
  }
  if (!safeEqual(key, configuredKey)) {
    return res.status(401).json({ error: 'API key ไม่ถูกต้อง' });
  }

  next();
}

module.exports = { requireApiKey };

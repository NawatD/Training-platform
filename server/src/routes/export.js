/* ============================================================
   Export API — ให้ "ระบบภายนอก" ดึงบทเรียนในระบบไปใช้ต่อ (ผ่าน API key เท่านั้น ไม่ใช่ login ผู้ใช้)
   - GET /export/content        รายการทั้งหมด "พร้อมเนื้อหาเต็ม" ในเรียกครั้งเดียว (เฉพาะบทเรียนที่เผยแพร่แล้ว + domain ที่ active)
   - GET /export/content/:id    เนื้อหาเต็มของบทเรียนเดียว (สิ่งที่ content_link ในรายการชี้ไปหา — เผื่อกรณีต้องดึงซ้ำทีละอันภายหลัง)
   ขอบเขต: 1 แถว = 1 บทเรียน (module) — ไม่ใช่ 1 หัวข้อย่อย (section) เพราะบทเรียนหนึ่งมักมีหลายหัวข้อย่อยปนกัน
   ============================================================ */
const express = require('express');
const { query } = require('../db');
const { requireApiKey } = require('../api-keys');

const router = express.Router();

// บทเรียนหนึ่งมีได้หลายหัวข้อย่อยที่ kind ไม่เหมือนกัน (เช่น html ปน video) — เลือก kind ที่ "หนักสุด/สื่อสมบูรณ์สุด" เป็นตัวแทนทั้งบทเรียน
// ลำดับนี้เลือกตามความซับซ้อนของสื่อ ไม่ใช่ลำดับตามตัวอักษร — ปรับได้ถ้าต้องการนิยาม type_of_content ต่างจากนี้
const KIND_PRIORITY = ['video', 'slide', 'pdf', 'embed', 'html'];
function representativeKind(kinds) {
  for (const k of KIND_PRIORITY) if (kinds.includes(k)) return k;
  return 'html'; // บทเรียนที่ยังไม่มีหัวข้อย่อยเลย — ถือเป็น html โดย default
}

// content_type: 'inline' = เนื้อหาอยู่ในฟิลด์ content ตรงๆ (html/embed URL) / 'url' = ต้องไปดึงไฟล์ที่ลิงก์นี้ต่อ (video/slide/pdf)
function mapSection(s, baseUrl) {
  return {
    heading: s.heading,
    kind: s.kind,
    content_type: s.asset_id ? 'url' : 'inline',
    content: s.asset_id ? `${baseUrl}/api/assets/${s.asset_id}/file` : (s.body || ''),
  };
}

/* ---------- List (คืนเนื้อหาเต็มของทุกบทเรียนมาในเรียกเดียว — ไม่ต้องวนเรียก /export/content/:id ทีละอัน) ---------- */
router.get('/export/content', requireApiKey, async (req, res) => {
  const domainSlug = req.query.domain || null;
  const updatedSince = req.query.updated_since || null;
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  const values = [];
  let whereDomain = '';
  if (domainSlug) {
    values.push(domainSlug);
    whereDomain = `AND d.slug = $${values.length}`;
  }

  let havingClause = '';
  if (updatedSince) {
    const parsed = new Date(updatedSince);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'updated_since ต้องเป็นวันที่รูปแบบ ISO 8601 เช่น 2026-08-01T00:00:00Z' });
    }
    values.push(parsed.toISOString());
    havingClause = `HAVING GREATEST(m.updated_at, COALESCE(MAX(s.updated_at), m.updated_at)) >= $${values.length}`;
  }

  const { rows: modules } = await query(
    `SELECT m.id, d.slug AS domain, m.title AS article_name, m.summary, m.level, m.sort_order,
            GREATEST(m.updated_at, COALESCE(MAX(s.updated_at), m.updated_at)) AS last_update_date,
            COALESCE(array_agg(DISTINCT s.kind) FILTER (WHERE s.kind IS NOT NULL), '{}') AS kinds
       FROM modules m
       JOIN domains d ON d.id = m.domain_id
       LEFT JOIN sections s ON s.module_id = m.id
      WHERE m.is_published = TRUE AND d.status = 'active' ${whereDomain}
      GROUP BY m.id, d.slug
      ${havingClause}
      ORDER BY d.slug, m.sort_order, m.created_at`,
    values
  );

  // ดึงหัวข้อย่อยของทุกบทเรียนที่แมตช์มาทีเดียว (query เดียว) แล้วจับกลุ่มตาม module_id ในโค้ด — เร็วกว่าวนคิวรีทีละบทเรียน
  const moduleIds = modules.map((m) => m.id);
  const sectionsByModule = {};
  if (moduleIds.length) {
    const { rows: sections } = await query(
      `SELECT * FROM sections WHERE module_id = ANY($1::uuid[]) ORDER BY module_id, sort_order, created_at`,
      [moduleIds]
    );
    for (const s of sections) {
      (sectionsByModule[s.module_id] || (sectionsByModule[s.module_id] = [])).push(mapSection(s, baseUrl));
    }
  }

  res.json(modules.map((m) => ({
    id: m.id,
    domain: m.domain,
    article_name: m.article_name,
    type_of_content: representativeKind(m.kinds || []),
    content_link: `${baseUrl}/api/export/content/${m.id}`,
    last_update_date: new Date(m.last_update_date).toISOString(),
    summary: m.summary,
    level: m.level,
    sections: sectionsByModule[m.id] || [],
  })));
});

/* ---------- Detail (เนื้อหาบทเรียนเดียว — เก็บไว้เผื่อต้องดึงซ้ำทีละอันภายหลัง ใช้ตัวเดียวกับที่ content_link ชี้ไป) ---------- */
router.get('/export/content/:id', requireApiKey, async (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  const { rows: modRows } = await query(
    `SELECT m.*, d.slug AS domain_slug, d.name AS domain_name
       FROM modules m
       JOIN domains d ON d.id = m.domain_id
      WHERE m.id = $1 AND m.is_published = TRUE AND d.status = 'active'`,
    [req.params.id]
  );
  const mod = modRows[0];
  if (!mod) return res.status(404).json({ error: 'ไม่พบบทเรียนนี้ หรือยังไม่เผยแพร่' });

  const { rows: sections } = await query(
    `SELECT s.* FROM sections s WHERE s.module_id = $1 ORDER BY s.sort_order, s.created_at`,
    [mod.id]
  );

  const lastUpdate = sections.reduce(
    (max, s) => (s.updated_at > max ? s.updated_at : max),
    mod.updated_at
  );

  res.json({
    id: mod.id,
    domain: mod.domain_slug,
    article_name: mod.title,
    summary: mod.summary,
    level: mod.level,
    type_of_content: representativeKind(sections.map((s) => s.kind)),
    last_update_date: new Date(lastUpdate).toISOString(),
    sections: sections.map((s) => mapSection(s, baseUrl)),
  });
});

module.exports = router;

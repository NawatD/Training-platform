const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { query, tx } = require('../db');
const { requireAdmin } = require('../auth');
const { STORAGE_DIR } = require('./assets');

const router = express.Router();

/* ============================================================
   DOMAINS
   ============================================================ */
router.get('/domains', async (req, res) => {
  const isAdmin = req.user && req.user.role === 'admin';
  const { rows } = await query(
    `SELECT d.*,
            (SELECT count(*) FROM modules m
              WHERE m.domain_id = d.id ${isAdmin ? '' : 'AND m.is_published'}) AS module_count
       FROM domains d
      ${isAdmin ? '' : "WHERE d.status <> 'archived'"}
      ORDER BY d.sort_order, d.name`
  );
  res.json(rows);
});

router.post('/domains', requireAdmin, async (req, res) => {
  const { slug, name, icon, description, status, sort_order } = req.body || {};
  if (!slug || !name) return res.status(400).json({ error: 'ต้องระบุ slug และชื่อ' });
  try {
    const { rows } = await query(
      `INSERT INTO domains (slug, name, icon, description, status, sort_order)
       VALUES ($1,$2,$3,$4,COALESCE($5,'active'),COALESCE($6,0)) RETURNING *`,
      [slug, name, icon || '📘', description || null, status, sort_order]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'slug ซ้ำ' });
    throw e;
  }
});

router.patch('/domains/:id', requireAdmin, async (req, res) => {
  const fields = ['slug', 'name', 'icon', 'description', 'status', 'sort_order'];
  const sets = [], vals = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { vals.push(req.body[f]); sets.push(`${f}=$${vals.length}`); }
  }
  if (!sets.length) return res.status(400).json({ error: 'ไม่มีข้อมูลให้แก้ไข' });
  vals.push(req.params.id);
  const { rows } = await query(`UPDATE domains SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING *`, vals);
  if (!rows[0]) return res.status(404).json({ error: 'ไม่พบ domain' });
  res.json(rows[0]);
});

router.delete('/domains/:id', requireAdmin, async (req, res) => {
  await query('DELETE FROM domains WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

/* ============================================================
   MODULES
   ============================================================ */
// List modules of a domain (slug or uuid), with learner progress flag
router.get('/domains/:key/modules', async (req, res) => {
  const isAdmin = req.user && req.user.role === 'admin';
  const domain = await findDomain(req.params.key);
  if (!domain) return res.status(404).json({ error: 'ไม่พบ domain' });

  const { rows } = await query(
    `SELECT m.*, u.full_name AS updated_by_name,
            (SELECT count(*) FROM sections s WHERE s.module_id = m.id) AS section_count,
            ($2::uuid IS NOT NULL AND EXISTS (
               SELECT 1 FROM module_progress p WHERE p.module_id = m.id AND p.user_id = $2::uuid
             )) AS completed
       FROM modules m
       LEFT JOIN users u ON u.id = m.updated_by
      WHERE m.domain_id = $1 ${isAdmin ? '' : 'AND m.is_published'}
      ORDER BY m.sort_order, m.created_at`,
    [domain.id, req.user ? req.user.sub : null]
  );
  res.json({ domain, modules: rows });
});

// Single module with its sections (+ asset info)
router.get('/modules/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT m.*, u.full_name AS updated_by_name FROM modules m
      LEFT JOIN users u ON u.id = m.updated_by WHERE m.id=$1`,
    [req.params.id]
  );
  const mod = rows[0];
  if (!mod) return res.status(404).json({ error: 'ไม่พบบทเรียน' });
  if (!mod.is_published && !(req.user && req.user.role === 'admin')) {
    return res.status(404).json({ error: 'ไม่พบบทเรียน' });
  }
  const sections = await query(
    `SELECT s.*, a.original_name AS asset_name, a.mime_type AS asset_mime,
            a.size_bytes AS asset_size, a.kind AS asset_kind,
            u.full_name AS updated_by_name
       FROM sections s
       LEFT JOIN assets a ON a.id = s.asset_id
       LEFT JOIN users u ON u.id = s.updated_by
      WHERE s.module_id=$1 ORDER BY s.sort_order, s.created_at`,
    [mod.id]
  );
  let completed = false;
  if (req.user) {
    const p = await query('SELECT 1 FROM module_progress WHERE user_id=$1 AND module_id=$2', [req.user.sub, mod.id]);
    completed = p.rowCount > 0;
  }
  res.json({ ...mod, completed, sections: sections.rows });
});

router.post('/modules', requireAdmin, async (req, res) => {
  const { domain_id, code, title, summary, level, duration, key_terms, sort_order, is_published } = req.body || {};
  if (!domain_id || !title) return res.status(400).json({ error: 'ต้องระบุ domain และชื่อบทเรียน' });
  const { rows } = await query(
    `INSERT INTO modules (domain_id, code, title, summary, level, duration, key_terms, sort_order, is_published, updated_by)
     VALUES ($1,$2,$3,$4,COALESCE($5,'foundation'),$6,COALESCE($7,'[]'::jsonb),
             COALESCE($8, (SELECT COALESCE(max(sort_order),0)+1 FROM modules WHERE domain_id=$1)),
             COALESCE($9,true), $10)
     RETURNING *`,
    [domain_id, code || null, title, summary || null, level, duration || null,
     JSON.stringify(key_terms || []), sort_order, is_published, req.user.sub]
  );
  res.status(201).json(rows[0]);
});

router.patch('/modules/:id', requireAdmin, async (req, res) => {
  const fields = ['domain_id', 'code', 'title', 'summary', 'level', 'duration', 'sort_order', 'is_published'];
  const sets = [], vals = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { vals.push(req.body[f]); sets.push(`${f}=$${vals.length}`); }
  }
  if (req.body.key_terms !== undefined) {
    vals.push(JSON.stringify(req.body.key_terms)); sets.push(`key_terms=$${vals.length}::jsonb`);
  }
  if (!sets.length) return res.status(400).json({ error: 'ไม่มีข้อมูลให้แก้ไข' });
  vals.push(req.user.sub); sets.push(`updated_by=$${vals.length}`);
  vals.push(req.params.id);
  const { rows } = await query(`UPDATE modules SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING *`, vals);
  if (!rows[0]) return res.status(404).json({ error: 'ไม่พบบทเรียน' });
  res.json(rows[0]);
});

router.delete('/modules/:id', requireAdmin, async (req, res) => {
  await query('DELETE FROM modules WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// Reorder modules: body = { order: [id, id, ...] }
router.post('/modules/reorder', requireAdmin, async (req, res) => {
  const order = (req.body && req.body.order) || [];
  await tx(async (c) => {
    for (let i = 0; i < order.length; i++) {
      await c.query('UPDATE modules SET sort_order=$1 WHERE id=$2', [i + 1, order[i]]);
    }
  });
  res.json({ ok: true });
});

/* ============================================================
   SECTIONS
   ============================================================ */
router.post('/sections', requireAdmin, async (req, res) => {
  const { module_id, heading, kind, body, asset_id, sort_order } = req.body || {};
  if (!module_id) return res.status(400).json({ error: 'ต้องระบุบทเรียน' });
  const { rows } = await query(
    `INSERT INTO sections (module_id, heading, kind, body, asset_id, sort_order, updated_by)
     VALUES ($1,$2,COALESCE($3,'html'),$4,$5,
             COALESCE($6,(SELECT COALESCE(max(sort_order),0)+1 FROM sections WHERE module_id=$1)), $7)
     RETURNING *`,
    [module_id, heading || null, kind, body || null, asset_id || null, sort_order, req.user.sub]
  );
  res.status(201).json(rows[0]);
});

router.patch('/sections/:id', requireAdmin, async (req, res) => {
  const fields = ['heading', 'kind', 'body', 'asset_id', 'sort_order'];
  const sets = [], vals = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { vals.push(req.body[f] === '' ? null : req.body[f]); sets.push(`${f}=$${vals.length}`); }
  }
  if (!sets.length) return res.status(400).json({ error: 'ไม่มีข้อมูลให้แก้ไข' });
  vals.push(req.user.sub); sets.push(`updated_by=$${vals.length}`);
  vals.push(req.params.id);
  const { rows } = await query(`UPDATE sections SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING *`, vals);
  if (!rows[0]) return res.status(404).json({ error: 'ไม่พบหัวข้อ' });
  res.json(rows[0]);
});

router.delete('/sections/:id', requireAdmin, async (req, res) => {
  await query('DELETE FROM sections WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// เขียนเนื้อหา html ลงไฟล์จริง สร้าง asset แล้วผูกกับหัวข้อนี้แทน body ที่พิมพ์ตรงๆ — ใช้ร่วมกันทั้งแปลงทีละอันและแปลงทีเดียวหลายอัน
async function convertSectionBodyToAsset(sec, html, actorUserId) {
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.html`;
  await fs.promises.writeFile(path.join(STORAGE_DIR, filename), html, 'utf8');
  const sizeBytes = Buffer.byteLength(html, 'utf8');
  const originalName = `${(sec.heading || 'เนื้อหา').slice(0, 80)}.html`;

  const { rows: [asset] } = await query(
    `INSERT INTO assets (filename, original_name, mime_type, size_bytes, kind, uploaded_by)
     VALUES ($1,$2,'text/html',$3,'html',$4) RETURNING *`,
    [filename, originalName, sizeBytes, actorUserId]
  );
  const { rows: [updated] } = await query(
    `UPDATE sections SET body=NULL, asset_id=$1, updated_by=$2 WHERE id=$3 RETURNING *`,
    [asset.id, actorUserId, sec.id]
  );
  return { asset, section: updated };
}

// แปลงเนื้อหา HTML ที่พิมพ์อยู่ในกล่องข้อความของหัวข้อนี้ ให้เป็นไฟล์ .html แล้วแนบเป็น asset แทน
// (ใช้ตอนเนื้อหายาว/ซับซ้อน ไม่อยากเก็บเป็นข้อความยาวๆ ในกล่องแก้ไข/DB โดยตรง) — บันทึกทันทีในคำขอเดียว
// รับเนื้อหาปัจจุบันจากฝั่ง client (ในกรณีที่ยังไม่ได้กด "บันทึก") ถ้าไม่ส่งมาจะใช้ค่าที่บันทึกไว้ล่าสุดแทน
router.post('/sections/:id/convert-to-file', requireAdmin, async (req, res) => {
  const { rows } = await query('SELECT * FROM sections WHERE id=$1', [req.params.id]);
  const sec = rows[0];
  if (!sec) return res.status(404).json({ error: 'ไม่พบหัวข้อนี้' });

  const html = (req.body && typeof req.body.body === 'string') ? req.body.body : (sec.body || '');
  if (!html.trim()) return res.status(400).json({ error: 'ไม่มีเนื้อหาให้แปลงเป็นไฟล์' });

  const result = await convertSectionBodyToAsset(sec, html, req.user.sub);
  res.json(result);
});

// แปลงทีเดียวทั้งระบบ — ทุกหัวข้อ kind=html ที่มีเนื้อหาพิมพ์ตรงๆ อยู่ (ไม่ว่าจะยาวหรือสั้น) ตามที่ผู้ใช้ยืนยันแล้วว่าอยากให้แปลงหมดไม่ต้องมีเกณฑ์ความยาว
function bulkConvertQuery(domain) {
  return {
    text: `SELECT s.*, d.slug AS domain_slug, m.title AS module_title
             FROM sections s
             JOIN modules m ON m.id = s.module_id
             JOIN domains d ON d.id = m.domain_id
            WHERE s.kind='html' AND s.body IS NOT NULL AND length(trim(s.body)) > 0
              ${domain ? 'AND d.slug = $1' : ''}
            ORDER BY length(s.body) DESC`,
    values: domain ? [domain] : [],
  };
}

// ดูก่อนว่าจะแปลงกี่หัวข้อ (preview อย่างเดียว ยังไม่เขียนอะไร)
router.get('/sections/bulk-convert-preview', requireAdmin, async (req, res) => {
  const q = bulkConvertQuery(req.query.domain || null);
  const { rows } = await query(q.text, q.values);
  res.json({
    count: rows.length,
    sections: rows.map((s) => ({ id: s.id, heading: s.heading, moduleTitle: s.module_title, domainSlug: s.domain_slug, length: s.body.length })),
  });
});

// แปลงจริงทีเดียวทั้งหมดที่เข้าเงื่อนไข (เฉพาะ domain ที่เลือก หรือทุก domain ถ้าไม่ระบุ)
router.post('/sections/bulk-convert-to-file', requireAdmin, async (req, res) => {
  const domain = (req.body && req.body.domain) || null;
  const q = bulkConvertQuery(domain);
  const { rows } = await query(q.text, q.values);
  let converted = 0;
  for (const sec of rows) {
    await convertSectionBodyToAsset(sec, sec.body, req.user.sub);
    converted++;
  }
  res.json({ converted });
});

router.post('/sections/reorder', requireAdmin, async (req, res) => {
  const order = (req.body && req.body.order) || [];
  await tx(async (c) => {
    for (let i = 0; i < order.length; i++) {
      await c.query('UPDATE sections SET sort_order=$1 WHERE id=$2', [i + 1, order[i]]);
    }
  });
  res.json({ ok: true });
});

/* ---------- helper ---------- */
async function findDomain(key) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
  const { rows } = await query(
    isUuid ? 'SELECT * FROM domains WHERE id=$1' : 'SELECT * FROM domains WHERE slug=$1',
    [key]
  );
  return rows[0];
}

module.exports = router;
module.exports.findDomain = findDomain;

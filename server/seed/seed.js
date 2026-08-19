/**
 * Seeds the database from legacy-content.json (extracted from QA-BAN~1.HTM)
 * plus the initial admin account. Idempotent: skips when data already exists.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, tx, waitForDb } = require('../src/db');

const LEGACY = path.join(__dirname, 'legacy-content.json');

// login เป็น Microsoft 365 SSO ล้วน ไม่มีรหัสผ่านของระบบเองแล้ว — ฟังก์ชันนี้แค่ "จองสิทธิ์ admin" ไว้ล่วงหน้าให้อีเมลนี้
// พอเจ้าของอีเมล login ผ่าน Microsoft 365 ครั้งแรก จะจับคู่เข้ากับ record นี้อัตโนมัติ (ดู routes/auth.js)
// ใช้ ON CONFLICT เผื่อกรณีอีเมลนี้เคย login เข้ามาเป็น learner ไปแล้วก่อนตั้งค่านี้ — จะยกระดับเป็น admin ให้
async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  const name = process.env.ADMIN_NAME || 'System Admin';

  await query(
    `INSERT INTO users (email, full_name, role) VALUES ($1,$2,'admin')
     ON CONFLICT (email) DO UPDATE SET role='admin'`,
    [email, name]
  );
  console.log(`[seed] admin ensured: ${email}`);
}

async function seedContent() {
  const already = await query('SELECT count(*)::int AS n FROM modules');
  if (already.rows[0].n > 0) return console.log('[seed] content already present, skipping');
  if (!fs.existsSync(LEGACY)) return console.log('[seed] no legacy-content.json found, skipping');

  const legacy = JSON.parse(fs.readFileSync(LEGACY, 'utf8'));

  await tx(async (c) => {
    const domainIds = {};

    for (let i = 0; i < legacy.domains.length; i++) {
      const d = legacy.domains[i];
      const { rows } = await c.query(
        `INSERT INTO domains (slug, name, icon, status, sort_order)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name
         RETURNING id`,
        [d.id, d.name, d.icon, d.status === 'soon' ? 'soon' : 'active', i + 1]
      );
      domainIds[d.id] = rows[0].id;
    }

    const bankingId = domainIds.banking;

    for (let i = 0; i < legacy.modules.length; i++) {
      const m = legacy.modules[i];
      const { rows } = await c.query(
        `INSERT INTO modules (domain_id, code, title, summary, level, duration, key_terms, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING id`,
        [bankingId, m.id, m.title, m.summary || null, m.level, m.duration || null,
         JSON.stringify(m.keyTerms || []), i + 1]
      );
      const moduleId = rows[0].id;

      const sections = m.sections || [];
      for (let s = 0; s < sections.length; s++) {
        await c.query(
          `INSERT INTO sections (module_id, heading, kind, body, sort_order)
           VALUES ($1,$2,'html',$3,$4)`,
          [moduleId, sections[s].h || null, sections[s].body || '', s + 1]
        );
      }
    }

    for (let i = 0; i < legacy.quizQuestions.length; i++) {
      const q = legacy.quizQuestions[i];
      await c.query(
        `INSERT INTO quiz_questions (domain_id, level, category, question, options, correct_index, explanation, sort_order)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
        [bankingId, q.level, q.category || null, q.q, JSON.stringify(q.opts), q.correct, q.exp || null, i + 1]
      );
    }

    console.log(`[seed] imported ${legacy.modules.length} modules, ${legacy.quizQuestions.length} quiz questions`);
  });
}

async function run() {
  await seedAdmin();
  await seedContent();
}

if (require.main === module) {
  (async () => {
    await waitForDb();
    await run();
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };

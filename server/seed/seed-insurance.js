/**
 * Seeds the "insurance" domain with its module/quiz content and flips its
 * status from 'soon' to 'active'.
 *
 * Default behavior is idempotent: skips content import if the domain
 * already has modules (safe to run repeatedly on a fresh deployment).
 *
 * To replace existing content with a newer version of insurance-content.json
 * (e.g. after this file was revised), pass --reset. This deletes the
 * domain's existing modules/sections/quiz questions first, then re-imports.
 * Learner accounts and progress on OTHER domains are untouched; progress
 * recorded specifically against insurance modules is cleared because the
 * module rows are replaced.
 *
 * Usage (inside the running app container):
 *   docker compose exec app node server/seed/seed-insurance.js
 *   docker compose exec app node server/seed/seed-insurance.js --reset
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, tx, waitForDb } = require('../src/db');

const FILE = path.join(__dirname, 'insurance-content.json');
const RESET = process.argv.includes('--reset') || process.env.RESET_INSURANCE === 'true';

async function run() {
  if (!fs.existsSync(FILE)) throw new Error('insurance-content.json not found');
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));

  // Ensure the domain exists and is active
  const existing = await query('SELECT id FROM domains WHERE slug=$1', [data.domain.slug]);
  let domainId;
  if (existing.rowCount) {
    domainId = existing.rows[0].id;
    await query('UPDATE domains SET status=$1, name=$2, icon=$3 WHERE id=$4',
      ['active', data.domain.name, data.domain.icon, domainId]);
    console.log(`[seed-insurance] domain "${data.domain.slug}" set to active`);
  } else {
    const { rows } = await query(
      `INSERT INTO domains (slug, name, icon, status, sort_order)
       VALUES ($1,$2,$3,'active',(SELECT COALESCE(max(sort_order),0)+1 FROM domains)) RETURNING id`,
      [data.domain.slug, data.domain.name, data.domain.icon]
    );
    domainId = rows[0].id;
    console.log(`[seed-insurance] domain "${data.domain.slug}" created`);
  }

  const already = await query('SELECT count(*)::int AS n FROM modules WHERE domain_id=$1', [domainId]);
  if (already.rows[0].n > 0) {
    if (!RESET) {
      console.log('[seed-insurance] modules already exist for this domain, skipping content import (use --reset to replace)');
      return;
    }
    console.log('[seed-insurance] --reset given: clearing existing modules and quiz questions for this domain');
    await query('DELETE FROM quiz_questions WHERE domain_id=$1', [domainId]);
    await query('DELETE FROM modules WHERE domain_id=$1', [domainId]); // cascades to sections + module_progress
  }

  await tx(async (c) => {
    for (let i = 0; i < data.modules.length; i++) {
      const m = data.modules[i];
      const { rows } = await c.query(
        `INSERT INTO modules (domain_id, code, title, summary, level, duration, key_terms, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING id`,
        [domainId, m.id, m.title, m.summary || null, m.level, m.duration || null,
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

    for (let i = 0; i < data.quizQuestions.length; i++) {
      const q = data.quizQuestions[i];
      await c.query(
        `INSERT INTO quiz_questions (domain_id, level, category, question, options, correct_index, explanation, sort_order)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
        [domainId, q.level, q.category || null, q.q, JSON.stringify(q.opts), q.correct, q.exp || null, i + 1]
      );
    }

    console.log(`[seed-insurance] imported ${data.modules.length} modules, ${data.quizQuestions.length} quiz questions`);
  });
}

if (require.main === module) {
  (async () => {
    await waitForDb();
    await run();
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };

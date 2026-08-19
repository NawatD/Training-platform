const express = require('express');
const { query } = require('../db');
const { requireAdmin, requireAuth } = require('../auth');
const { findDomain } = require('./content');

const router = express.Router();

// Learner view: questions WITHOUT the answer key
router.get('/domains/:key/quiz', async (req, res) => {
  const domain = await findDomain(req.params.key);
  if (!domain) return res.status(404).json({ error: 'ไม่พบ domain' });
  const isAdmin = req.user && req.user.role === 'admin';
  const { rows } = await query(
    isAdmin
      ? `SELECT q.id, q.level, q.category, q.question, q.options,
                q.correct_index, q.explanation, q.is_active, q.sort_order,
                q.updated_at, u.full_name AS updated_by_name
           FROM quiz_questions q
           LEFT JOIN users u ON u.id = q.updated_by
          WHERE q.domain_id=$1
          ORDER BY q.sort_order, q.created_at`
      : `SELECT id, level, category, question, options FROM quiz_questions
          WHERE domain_id=$1 AND is_active ORDER BY sort_order, created_at`,
    [domain.id]
  );
  res.json({ domain, questions: rows });
});

// Submit answers -> graded server-side, attempt stored
router.post('/domains/:key/quiz/submit', requireAuth, async (req, res) => {
  const domain = await findDomain(req.params.key);
  if (!domain) return res.status(404).json({ error: 'ไม่พบ domain' });

  const answers = (req.body && req.body.answers) || {}; // { questionId: selectedIndex }
  const ids = Object.keys(answers);
  if (!ids.length) return res.status(400).json({ error: 'ไม่มีคำตอบส่งมา' });

  const { rows } = await query(
    'SELECT id, level, category, question, options, correct_index, explanation FROM quiz_questions WHERE domain_id=$1 AND id = ANY($2::uuid[])',
    [domain.id, ids]
  );

  let score = 0;
  const breakdown = {};
  const detail = rows.map((q) => {
    const picked = answers[q.id];
    const correct = picked === q.correct_index;
    if (correct) score++;
    breakdown[q.level] = breakdown[q.level] || { correct: 0, total: 0 };
    breakdown[q.level].total++;
    if (correct) breakdown[q.level].correct++;
    return {
      id: q.id, level: q.level, category: q.category, question: q.question,
      options: q.options, picked, correct_index: q.correct_index,
      correct, explanation: q.explanation,
    };
  });

  const total = rows.length;
  const percent = total ? Math.round((score / total) * 10000) / 100 : 0;

  const saved = await query(
    `INSERT INTO quiz_attempts (user_id, domain_id, score, total, percent, breakdown, answers)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) RETURNING id, created_at`,
    [req.user.sub, domain.id, score, total, percent, JSON.stringify(breakdown), JSON.stringify(answers)]
  );

  res.json({ attempt_id: saved.rows[0].id, score, total, percent, breakdown, detail });
});

router.get('/quiz/attempts', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT a.id, a.score, a.total, a.percent, a.breakdown, a.created_at, d.name AS domain_name
       FROM quiz_attempts a JOIN domains d ON d.id = a.domain_id
      WHERE a.user_id=$1 ORDER BY a.created_at DESC LIMIT 50`,
    [req.user.sub]
  );
  res.json(rows);
});

/* ---------- Admin CRUD ---------- */
router.post('/quiz', requireAdmin, async (req, res) => {
  const { domain_id, module_id, level, category, question, options, correct_index, explanation, sort_order } = req.body || {};
  if (!domain_id || !question || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: 'ต้องระบุ domain, คำถาม และตัวเลือกอย่างน้อย 2 ข้อ' });
  }
  if (correct_index == null || correct_index < 0 || correct_index >= options.length) {
    return res.status(400).json({ error: 'correct_index ไม่ถูกต้อง' });
  }
  const { rows } = await query(
    `INSERT INTO quiz_questions (domain_id, module_id, level, category, question, options, correct_index, explanation, sort_order, updated_by)
     VALUES ($1,$2,COALESCE($3,'foundation'),$4,$5,$6::jsonb,$7,$8,
             COALESCE($9,(SELECT COALESCE(max(sort_order),0)+1 FROM quiz_questions WHERE domain_id=$1)), $10)
     RETURNING *`,
    [domain_id, module_id || null, level, category || null, question,
     JSON.stringify(options), correct_index, explanation || null, sort_order, req.user.sub]
  );
  res.status(201).json(rows[0]);
});

router.patch('/quiz/:id', requireAdmin, async (req, res) => {
  const fields = ['module_id', 'level', 'category', 'question', 'correct_index', 'explanation', 'is_active', 'sort_order'];
  const sets = [], vals = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { vals.push(req.body[f]); sets.push(`${f}=$${vals.length}`); }
  }
  if (req.body.options !== undefined) {
    vals.push(JSON.stringify(req.body.options)); sets.push(`options=$${vals.length}::jsonb`);
  }
  if (!sets.length) return res.status(400).json({ error: 'ไม่มีข้อมูลให้แก้ไข' });
  vals.push(req.user.sub); sets.push(`updated_by=$${vals.length}`);
  vals.push(req.params.id);
  const { rows } = await query(`UPDATE quiz_questions SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING *`, vals);
  if (!rows[0]) return res.status(404).json({ error: 'ไม่พบคำถาม' });
  res.json(rows[0]);
});

router.delete('/quiz/:id', requireAdmin, async (req, res) => {
  await query('DELETE FROM quiz_questions WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;

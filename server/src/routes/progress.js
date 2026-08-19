const express = require('express');
const { query } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router();

// Mark module complete / incomplete
router.post('/progress/:moduleId', requireAuth, async (req, res) => {
  const completed = req.body && req.body.completed === false ? false : true;
  if (completed) {
    await query(
      `INSERT INTO module_progress (user_id, module_id) VALUES ($1,$2)
       ON CONFLICT (user_id, module_id) DO UPDATE SET completed_at = now()`,
      [req.user.sub, req.params.moduleId]
    );
  } else {
    await query('DELETE FROM module_progress WHERE user_id=$1 AND module_id=$2', [req.user.sub, req.params.moduleId]);
  }
  res.json({ ok: true, completed });
});

// My progress summary per domain
router.get('/progress', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT d.id, d.slug, d.name,
            count(m.id)::int AS total,
            count(p.module_id)::int AS done
       FROM domains d
       LEFT JOIN modules m ON m.domain_id = d.id AND m.is_published
       LEFT JOIN module_progress p ON p.module_id = m.id AND p.user_id = $1
      GROUP BY d.id ORDER BY d.sort_order`,
    [req.user.sub]
  );
  res.json(rows);
});

// Admin: team-wide report
router.get('/reports/overview', requireAdmin, async (_req, res) => {
  const learners = await query(
    `SELECT u.id, u.full_name, u.email,
            count(p.module_id)::int AS modules_done,
            (SELECT count(*)::int FROM quiz_attempts qa WHERE qa.user_id = u.id) AS attempts,
            (SELECT max(percent) FROM quiz_attempts qa WHERE qa.user_id = u.id) AS best_score,
            (SELECT max(created_at) FROM quiz_attempts qa WHERE qa.user_id = u.id) AS last_attempt
       FROM users u
       LEFT JOIN module_progress p ON p.user_id = u.id
      WHERE u.role = 'learner'
      GROUP BY u.id ORDER BY u.full_name`
  );
  const totals = await query(
    `SELECT (SELECT count(*)::int FROM modules WHERE is_published) AS published_modules,
            (SELECT count(*)::int FROM domains WHERE status='active') AS active_domains,
            (SELECT count(*)::int FROM quiz_questions WHERE is_active) AS quiz_questions,
            (SELECT count(*)::int FROM users WHERE role='learner') AS learners,
            (SELECT count(*)::int FROM assets) AS assets`
  );
  res.json({ totals: totals.rows[0], learners: learners.rows });
});

module.exports = router;

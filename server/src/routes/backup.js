const express = require('express');
const { requireAdmin } = require('../auth');
const backup = require('../backup');

const router = express.Router();

/* ---------- List ---------- */
router.get('/backups', requireAdmin, async (_req, res) => {
  const items = await backup.listBackups();
  res.json({ retentionDays: backup.RETENTION_DAYS, items });
});

/* ---------- Manual backup now ---------- */
router.post('/backups', requireAdmin, async (req, res) => {
  const label = req.body && req.body.label ? String(req.body.label).slice(0, 120) : null;
  const entry = await backup.createBackup('manual', label);
  res.status(201).json(entry);
});

/* ---------- Restore ---------- */
router.post('/backups/:id/restore', requireAdmin, async (req, res) => {
  const result = await backup.restoreBackup(req.params.id);
  res.json({ ok: true, ...result });
});

/* ---------- Delete ---------- */
router.delete('/backups/:id', requireAdmin, async (req, res) => {
  await backup.deleteBackup(req.params.id);
  res.json({ ok: true });
});

module.exports = router;

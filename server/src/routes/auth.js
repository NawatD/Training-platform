const express = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const { signToken, COOKIE_NAME, requireAdmin } = require('../auth');
const { msalClient, SCOPES, REDIRECT_URI, isConfigured } = require('../msal');

const router = express.Router();
const STATE_COOKIE = 'itp_oauth_state';

/* ============================================================
   Microsoft 365 SSO — login เดียวของระบบ (ไม่มีรหัสผ่านของระบบเองแล้ว)
   คนในบริษัททุกคนที่มีบัญชี Microsoft 365 ของ tenant นี้เข้าใช้งานได้ (auto-provision เป็น learner)
   ส่วนใครเป็น admin กำหนดที่หน้า Admin > ผู้ใช้งาน เท่านั้น
   ============================================================ */

// step 1: พาไปหน้า login ของ Microsoft พร้อม state แบบสุ่มกัน CSRF (เก็บไว้ใน cookie ชั่วคราว)
router.get('/auth/microsoft/login', async (req, res) => {
  if (!isConfigured) return res.status(500).send('ยังไม่ได้ตั้งค่า Microsoft 365 login ฝั่งเซิร์ฟเวอร์ — ตรวจ MICROSOFT_CLIENT_ID/CLIENT_SECRET/TENANT_ID/REDIRECT_URI ใน .env');
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 * 1000 });
  try {
    const url = await msalClient.getAuthCodeUrl({ scopes: SCOPES, redirectUri: REDIRECT_URI, state });
    res.redirect(url);
  } catch (e) {
    console.error('[auth] getAuthCodeUrl failed', e);
    res.redirect('/?error=sso_config');
  }
});

// step 2: Microsoft redirect กลับมาที่นี่พร้อม code — แลกเป็น token แล้วผูกกับผู้ใช้ในระบบด้วยอีเมล
router.get('/auth/microsoft/callback', async (req, res) => {
  if (!isConfigured) return res.redirect('/?error=sso_config');
  const { code, state, error: msError } = req.query;
  const expectedState = req.cookies && req.cookies[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE);

  if (msError) return res.redirect('/?error=sso_denied');
  if (!code || !state || !expectedState || state !== expectedState) return res.redirect('/?error=sso_state');

  let result;
  try {
    result = await msalClient.acquireTokenByCode({ code, scopes: SCOPES, redirectUri: REDIRECT_URI });
  } catch (e) {
    console.error('[auth] acquireTokenByCode failed', e);
    return res.redirect('/?error=sso_token');
  }

  const claims = result.idTokenClaims || {};
  const email = String(claims.preferred_username || claims.email || (result.account && result.account.username) || '').toLowerCase();
  const name = claims.name || email;
  if (!email) return res.redirect('/?error=sso_no_email');

  const { rows } = await query('SELECT * FROM users WHERE lower(email)=$1', [email]);
  let user = rows[0];

  if (!user) {
    // เข้าระบบครั้งแรก — สร้างบัญชีให้อัตโนมัติเป็น learner (คนในบริษัททุกคนเข้าได้)
    // ยกเว้นถ้ามีใครเตรียมอีเมลนี้ไว้เป็น admin ล่วงหน้าแล้วที่หน้า Admin > ผู้ใช้งาน — กรณีนั้น user จะมีอยู่แล้วในระบบตั้งแต่ก่อน login ครั้งแรก
    const created = await query(
      `INSERT INTO users (email, full_name, role) VALUES ($1,$2,'learner') RETURNING *`,
      [email, name]
    );
    user = created.rows[0];
  } else {
    if (!user.is_active) return res.redirect('/?error=sso_inactive');
    if (user.full_name !== name) {
      await query('UPDATE users SET full_name=$1 WHERE id=$2', [name, user.id]);
      user.full_name = name;
    }
  }

  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', maxAge: 12 * 3600 * 1000 });
  res.redirect('/');
});

router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: { id: req.user.sub, email: req.user.email, name: req.user.name, role: req.user.role } });
});

/* ---------- Admin user management ----------
   ไม่มีรหัสผ่านให้ตั้งแล้ว — "เพิ่มผู้ใช้" ที่นี่คือการเตรียมอีเมลไว้ล่วงหน้า (เช่นตั้งเป็น admin ให้ก่อนที่คนนั้นจะ login ครั้งแรก)
   พอเจ้าของอีเมลนั้น login ผ่าน Microsoft 365 ครั้งแรก ระบบจะผูกเข้ากับบัญชีที่เตรียมไว้นี้โดยอัตโนมัติ (จับคู่ด้วยอีเมล) */
router.get('/users', requireAdmin, async (_req, res) => {
  const { rows } = await query(
    'SELECT id, email, full_name, role, is_active, created_at FROM users ORDER BY created_at'
  );
  res.json(rows);
});

router.post('/users', requireAdmin, async (req, res) => {
  const { email, full_name, role } = req.body || {};
  if (!email || !full_name) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
  try {
    const { rows } = await query(
      `INSERT INTO users (email, full_name, role)
       VALUES ($1,$2,$3) RETURNING id, email, full_name, role, is_active, created_at`,
      [email.toLowerCase(), full_name, role === 'admin' ? 'admin' : 'learner']
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'อีเมลนี้ถูกใช้แล้ว' });
    throw e;
  }
});

router.patch('/users/:id', requireAdmin, async (req, res) => {
  const { full_name, role, is_active } = req.body || {};
  const sets = [];
  const vals = [];
  const add = (frag, val) => { vals.push(val); sets.push(`${frag}=$${vals.length}`); };
  if (full_name !== undefined) add('full_name', full_name);
  if (role !== undefined) add('role', role === 'admin' ? 'admin' : 'learner');
  if (is_active !== undefined) add('is_active', !!is_active);
  if (!sets.length) return res.status(400).json({ error: 'ไม่มีข้อมูลให้แก้ไข' });
  vals.push(req.params.id);
  const { rows } = await query(
    `UPDATE users SET ${sets.join(', ')} WHERE id=$${vals.length}
     RETURNING id, email, full_name, role, is_active, created_at`, vals
  );
  if (!rows[0]) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  res.json(rows[0]);
});

router.delete('/users/:id', requireAdmin, async (req, res) => {
  if (req.params.id === req.user.sub) return res.status(400).json({ error: 'ลบบัญชีตัวเองไม่ได้' });
  await query('DELETE FROM users WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;

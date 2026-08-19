const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const TOKEN_TTL = '12h';
const COOKIE_NAME = 'itp_token';

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.full_name },
    SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function readToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  if (req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  return null;
}

// Attaches req.user when a valid token is present; never rejects.
function attachUser(req, _res, next) {
  const token = readToken(req);
  if (token) {
    try {
      req.user = jwt.verify(token, SECRET);
    } catch (_) {
      /* expired / invalid — treat as anonymous */
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'ต้องเข้าสู่ระบบก่อน' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'ต้องเข้าสู่ระบบก่อน' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'ต้องมีสิทธิ์ผู้ดูแลระบบ' });
  next();
}

module.exports = { signToken, attachUser, requireAuth, requireAdmin, COOKIE_NAME, SECRET };

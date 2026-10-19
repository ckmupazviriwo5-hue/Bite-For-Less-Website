import jwt from 'jsonwebtoken';
import db from '../config/db.js';
import { config } from '../config/env.js';

export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);

    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }

    // Account status is enforced on EVERY authenticated request, not only
    // at login: a suspended/disabled account is cut off immediately, even
    // with a still-valid token.
    if (user.status === 'suspended' || user.status === 'disabled') {
      return res.status(403).json({
        success: false,
        message: user.status === 'suspended'
          ? 'Your account has been suspended by an administrator.'
          : 'Your account has been disabled.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'You are not allowed to access this resource.' });
    }
    next();
  };
}

// Attaches req.user when a valid token is present, but never blocks
// anonymous requests — used by public endpoints that optionally unlock more
// data for trusted roles (e.g. admin category lists).
export function optionalAuthenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      const user = db.prepare('SELECT id, role, status FROM users WHERE id = ?').get(decoded.id);
      if (user && user.status !== 'suspended' && user.status !== 'disabled') req.user = user;
    } catch { /* treat as anonymous */ }
  }
  next();
}

export function requireShopOwnerOrAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'shop_owner' && req.user.role !== 'admin')) {
    return res.status(403).json({ success: false, message: 'Shop owner or admin access required.' });
  }
  next();
}

// Write actions require an active account (vendors awaiting approval may log in
// and browse their onboarding state, but cannot publish or reserve).
export function requireActive(req, res, next) {
  if (!req.user || req.user.status !== 'active') {
    return res.status(403).json({ success: false, message: 'Your account is not active yet. This action needs an approved account.' });
  }
  next();
}

// Resolves the authenticated vendor's shop row (or null for admins without one).
export function myShop(userId) {
  return db.prepare('SELECT * FROM shops WHERE owner_id = ?').get(userId) || null;
}

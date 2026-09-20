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

export function requireShopOwnerOrAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'shop_owner' && req.user.role !== 'admin')) {
    return res.status(403).json({ success: false, message: 'Shop owner or admin access required.' });
  }
  next();
}

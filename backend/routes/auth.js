import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../config/db.js';
import { config } from '../config/env.js';
import { authenticate } from '../middleware/auth.js';
import { sanitizeText, makeId } from '../utils/helpers.js';
import { isValidEmail, isValidPassword, hasRequiredFields } from '../utils/validation.js';
import { registerShopOwner, signToken } from './vendors.js';

const router = express.Router();

router.post('/register', async (req, res) => {
  const body = req.body || {};
  const required = ['name', 'email', 'password', 'phone'];

  if (!hasRequiredFields(body, required)) {
    return res.status(400).json({ success: false, message: 'Name, email, phone, and password are required.' });
  }

  if (!isValidEmail(body.email)) {
    return res.status(400).json({ success: false, message: 'Please use a valid email address.' });
  }

  if (!isValidPassword(body.password)) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
  }

  const normalizedEmail = sanitizeText(body.email).toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ success: false, message: 'An account with that email already exists.' });
  }

  const hash = await bcrypt.hash(body.password, 10);
  const user = {
    id: makeId('user'),
    name: sanitizeText(body.name),
    email: normalizedEmail,
    phone: sanitizeText(body.phone),
    password_hash: hash,
    role: 'customer',
    status: 'active'
  };

  try {
    db.prepare('INSERT INTO users (id, name, email, phone, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(user.id, user.name, user.email, user.phone, user.password_hash, user.role, user.status);
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to create the account. Please try again.' });
  }

  const token = signToken(user);
  return res.status(201).json({ success: true, message: 'Account created successfully.', token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// Unified login for ALL roles. One endpoint, one trusted role from the server.
function loginHandler(adminMode = false) {
  return async (req, res) => {
    const email = sanitizeText(req.body?.email || '').toLowerCase();
    const password = req.body?.password || '';

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (adminMode) {
      if (!user || user.role !== 'admin') {
        return res.status(401).json({ success: false, message: 'Admin account not found.' });
      }
    }
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'Your account is suspended. Contact the Bite For Less team.' });
    }
    if (user.status === 'disabled') {
      return res.status(403).json({ success: false, message: 'This account has been disabled by an administrator.' });
    }

    const token = signToken(user);
    return res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone, status: user.status } });
  };
}

router.post('/login', loginHandler(false));
router.post('/admin/login', loginHandler(true));

router.get('/me', authenticate, (req, res) => {
  const { password_hash: _hidden, ...user } = req.user;
  return res.json({ success: true, user });
});

// Logout is client-side (stateless JWT); the route exists for API symmetry.
router.post('/logout', (req, res) => {
  return res.json({ success: true, message: 'Logged out. Clear the token on the client.' });
});

router.post('/change-password', authenticate, async (req, res) => {
  const current = req.body?.current_password || '';
  const next = req.body?.new_password || '';

  if (!current || !next) {
    return res.status(400).json({ success: false, message: 'Current and new passwords are required.' });
  }
  if (!isValidPassword(next)) {
    return res.status(400).json({ success: false, message: 'New password must be at least 6 characters long.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

  const matches = await bcrypt.compare(current, user.password_hash);
  if (!matches) {
    return res.status(401).json({ success: false, message: 'Your current password is incorrect.' });
  }

  const hash = await bcrypt.hash(next, 10);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(hash, new Date().toISOString(), user.id);
  return res.json({ success: true, message: 'Password changed. Note: issued session tokens stay valid until expiry (no server-side revocation).' });
});

// Legacy alias kept for compatibility — canonical endpoint is /api/vendors/register.
router.post('/shop-owner/register', (req, res) => {
  const user = registerShopOwner(req.body || {}, res);
  if (!user) return;
  const token = signToken(user);
  return res.status(201).json({
    success: true,
    message: 'Shop application received. Awaiting admin approval.',
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status }
  });
});

export default router;

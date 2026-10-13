import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../config/db.js';
import { config } from '../config/env.js';
import { generateReservationCode, makeId, sanitizeText, toNumber } from '../utils/helpers.js';
import { isValidEmail, isValidPassword, hasRequiredFields } from '../utils/validation.js';

const router = express.Router();

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email }, config.jwtSecret, { expiresIn: '7d' });
}

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
    db.prepare(`INSERT INTO users (id, name, email, phone, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(user.id, user.name, user.email, user.phone, user.password_hash, user.role, user.status);
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to create the account. Please try again.' });
  }

  const token = signToken(user);
  return res.status(201).json({ success: true, message: 'Account created successfully.', token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

router.post('/login', async (req, res) => {
  const email = sanitizeText(req.body?.email || '').toLowerCase();
  const password = req.body?.password || '';

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }

  const token = signToken(user);
  return res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone } });
});

router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  try {
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = db.prepare('SELECT id, name, email, phone, role, status FROM users WHERE id = ?').get(decoded.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    return res.json({ success: true, user });
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
});

router.post('/logout', (req, res) => {
  return res.json({ success: true, message: 'Logged out successfully.' });
});

router.post('/shop-owner/register', async (req, res) => {
  const body = req.body || {};
  const required = ['owner_name', 'shop_name', 'email', 'phone', 'address', 'password'];

  if (!hasRequiredFields(body, required)) {
    return res.status(400).json({ success: false, message: 'All shop-owner fields are required.' });
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
  const userId = makeId('shop');
  const user = {
    id: userId,
    name: sanitizeText(body.owner_name),
    email: normalizedEmail,
    phone: sanitizeText(body.phone),
    password_hash: hash,
    role: 'shop_owner',
    status: 'pending'
  };

  try {
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO users (id, name, email, phone, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(user.id, user.name, user.email, user.phone, user.password_hash, user.role, user.status);

      db.prepare('INSERT INTO shops (id, owner_id, name, email, phone, address, city, business_info, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(makeId('shop_record'), user.id, sanitizeText(body.shop_name), normalizedEmail, sanitizeText(body.phone), sanitizeText(body.address), sanitizeText(body.city || ''), sanitizeText(body.business_info || ''), 'pending');
    });
    tx();
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to register the shop account. Please try again.' });
  }

  const token = signToken(user);
  return res.status(201).json({ success: true, message: 'Shop application received. Awaiting admin approval.', token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

router.post('/admin/login', async (req, res) => {
  const email = sanitizeText(req.body?.email || '').toLowerCase();
  const password = req.body?.password || '';
  const adminExists = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (!adminExists || adminExists.role !== 'admin') {
    return res.status(401).json({ success: false, message: 'Admin account not found.' });
  }

  const passwordMatches = await bcrypt.compare(password, adminExists.password_hash);
  if (!passwordMatches) {
    return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
  }

  const token = signToken(adminExists);
  return res.json({ success: true, token, user: { id: adminExists.id, name: adminExists.name, email: adminExists.email, role: adminExists.role } });
});

export default router;

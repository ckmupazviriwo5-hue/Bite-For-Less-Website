import express from 'express';
import db from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { makeId, sanitizeText } from '../utils/helpers.js';

const router = express.Router();

router.post('/apply', async (req, res) => {
  const body = req.body || {};
  const required = ['shop_name', 'owner_name', 'email', 'phone', 'address'];

  if (!required.every((field) => sanitizeText(body[field]).length > 0)) {
    return res.status(400).json({ success: false, message: 'All shop application fields are required.' });
  }

  const existing = db.prepare('SELECT id FROM shops WHERE email = ?').get(sanitizeText(body.email).toLowerCase());
  if (existing) {
    return res.status(409).json({ success: false, message: 'A shop with that email already exists.' });
  }

  const shopId = makeId('shop');
  try {
    // Applications precede any owner account, so owner_id stays NULL until a
    // linked user is created (e.g. via shop-owner registration + approval).
    db.prepare('INSERT INTO shops (id, owner_id, name, email, phone, address, city, business_info, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(shopId, null, sanitizeText(body.shop_name), sanitizeText(body.email).toLowerCase(), sanitizeText(body.phone), sanitizeText(body.address), sanitizeText(body.city || ''), sanitizeText(body.business_info || ''), 'pending');
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to submit the application. Please try again.' });
  }

  return res.status(201).json({ success: true, message: 'Shop application submitted successfully.' });
});

router.get('/me', authenticate, requireRole('shop_owner', 'admin'), (req, res) => {
  const shop = db.prepare('SELECT * FROM shops WHERE owner_id = ?').get(req.user.id);
  if (!shop) {
    return res.status(404).json({ success: false, message: 'No shop record found for this account.' });
  }
  return res.json({ success: true, shop });
});

router.get('/me/reservations', authenticate, requireRole('shop_owner', 'admin'), (req, res) => {
  const shop = db.prepare('SELECT * FROM shops WHERE owner_id = ?').get(req.user.id);
  if (!shop) {
    return res.status(404).json({ success: false, message: 'No shop record found for this account.' });
  }
  const rows = db.prepare('SELECT * FROM reservations WHERE shop_id = ? ORDER BY created_at DESC').all(shop.id);
  return res.json({ success: true, reservations: rows });
});

router.get('/:id', (req, res) => {
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.params.id);
  if (!shop) {
    return res.status(404).json({ success: false, message: 'Shop not found.' });
  }
  return res.json({ success: true, shop });
});

export default router;

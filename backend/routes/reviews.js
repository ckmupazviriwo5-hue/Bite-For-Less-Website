import express from 'express';
import db from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { makeId, sanitizeText } from '../utils/helpers.js';

const router = express.Router();

router.get('/', (req, res) => {
  const reviews = db.prepare('SELECT r.*, u.name as user_name, s.name as shop_name FROM reviews r JOIN users u ON u.id = r.user_id JOIN shops s ON s.id = r.shop_id ORDER BY r.created_at DESC').all();
  return res.json({ success: true, reviews });
});

router.post('/', authenticate, (req, res) => {
  const body = req.body || {};
  const rating = Number(body.rating);
  const comment = sanitizeText(body.comment || '');
  const dealId = sanitizeText(body.deal_id || '');
  const shopId = sanitizeText(body.shop_id || '');

  if (!dealId || !shopId || !rating || rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, message: 'Review rating and deal details are required.' });
  }

  const reservation = db.prepare('SELECT * FROM reservations WHERE deal_id = ? AND user_id = ? AND status = ?').get(dealId, req.user.id, 'collected');
  if (!reservation) {
    return res.status(403).json({ success: false, message: 'You can only review deals you collected.' });
  }

  const reviewId = makeId('review');
  db.prepare('INSERT INTO reviews (id, user_id, shop_id, deal_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(reviewId, req.user.id, shopId, dealId, rating, comment, new Date().toISOString());

  return res.status(201).json({ success: true, message: 'Thanks for your review.' });
});

export default router;

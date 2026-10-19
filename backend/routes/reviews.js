import express from 'express';
import db from '../config/db.js';
import { authenticate, optionalAuthenticate, requireRole } from '../middleware/auth.js';
import { makeId, sanitizeText, nowIso, logActivity, notifyUsers } from '../utils/helpers.js';

const router = express.Router();

// Public reviews: published rows only. With ?all=1 and a valid ADMIN token the
// hidden rows appear too so admins can un-hide mistaken moderation.
router.get('/', optionalAuthenticate, (req, res) => {
  const shopId = sanitizeText(req.query.shop_id);
  const dealId = sanitizeText(req.query.deal_id);
  const adminAll = req.query.all === '1' && req.user && req.user.role === 'admin';
  let sql = `SELECT r.id, r.rating, r.comment, r.moderation_status, r.created_at, u.name as user_name, s.name as shop_name, r.deal_id, r.shop_id
             FROM reviews r JOIN users u ON u.id = r.user_id JOIN shops s ON s.id = r.shop_id
             WHERE ${adminAll ? '1=1' : "r.moderation_status = 'published'"}`;
  const params = [];
  if (shopId) { sql += ' AND r.shop_id = ?'; params.push(shopId); }
  if (dealId) { sql += ' AND r.deal_id = ?'; params.push(dealId); }
  sql += ' ORDER BY r.created_at DESC LIMIT ?';
  params.push(Math.max(1, Math.min(100, Number(req.query.limit) || 50)));
  return res.json({ success: true, reviews: db.prepare(sql).all(...params) });
});

// A customer can review a listing only after collecting a reservation on it.
router.post('/', authenticate, (req, res) => {
  const body = req.body || {};
  const rating = Number(body.rating);
  const comment = sanitizeText(body.comment || '');
  const dealId = sanitizeText(body.deal_id || '');

  if (!dealId || !rating || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    return res.status(400).json({ success: false, message: 'Rating must be a whole number from 1 to 5.' });
  }

  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
  if (!deal) {
    return res.status(404).json({ success: false, message: 'Deal not found.' });
  }

  const reservation = db.prepare('SELECT * FROM reservations WHERE deal_id = ? AND user_id = ? AND status = ?').get(dealId, req.user.id, 'collected');
  if (!reservation) {
    return res.status(403).json({ success: false, message: 'You can only review deals you collected.' });
  }

  const already = db.prepare('SELECT id FROM reviews WHERE deal_id = ? AND user_id = ?').get(dealId, req.user.id);
  if (already) {
    return res.status(409).json({ success: false, message: 'You have already reviewed this deal.' });
  }

  const reviewId = makeId('review');
  db.prepare('INSERT INTO reviews (id, user_id, shop_id, deal_id, rating, comment, moderation_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(reviewId, req.user.id, deal.shop_id, dealId, rating, comment, 'published', nowIso());

  const shop = db.prepare('SELECT owner_id FROM shops WHERE id = ?').get(deal.shop_id);
  if (shop?.owner_id) {
    notifyUsers([shop.owner_id], {
      type: 'review',
      title: 'New review received',
      message: `${req.user.name} rated ${deal.food_name} ${rating}/5.`
    });
  }
  return res.status(201).json({ success: true, message: 'Thanks for your review.' });
});

// Admin moderation.
router.patch('/:id/status', authenticate, requireRole('admin'), (req, res) => {
  const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (!review) return res.status(404).json({ success: false, message: 'Review not found.' });
  const status = sanitizeText(req.body?.status);
  if (!['published', 'hidden'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Status must be "published" or "hidden".' });
  }
  db.prepare('UPDATE reviews SET moderation_status = ? WHERE id = ?').run(status, req.params.id);
  logActivity({ actorId: req.user.id, actorRole: req.user.role, action: 'review.moderate', targetType: 'review', targetId: req.params.id, metadata: { to: status } });
  return res.json({ success: true, message: `Review ${status === 'hidden' ? 'hidden' : 'published'}.` });
});

export default router;

import express from 'express';
import crypto from 'crypto';
import db from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { sanitizeText, nowIso } from '../utils/helpers.js';

const router = express.Router();

router.get('/', authenticate, (req, res) => {
  const rows = db.prepare(`
    SELECT f.id, f.deal_id, f.created_at, d.food_name, d.discounted_price, d.original_price, d.quantity_remaining, d.expires_at, d.image_path, d.image_url, d.status as deal_status, s.name as shop_name
    FROM favorites f
    LEFT JOIN deals d ON d.id = f.deal_id
    LEFT JOIN shops s ON s.id = d.shop_id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC`).all(req.user.id);
  return res.json({ success: true, favorites: rows });
});

// Toggle-style: POST adds (or reports already present), DELETE removes.
router.post('/', authenticate, (req, res) => {
  const dealId = sanitizeText(req.body?.deal_id);
  if (!dealId) return res.status(400).json({ success: false, message: 'deal_id is required.' });
  const deal = db.prepare('SELECT id FROM deals WHERE id = ?').get(dealId);
  if (!deal) return res.status(404).json({ success: false, message: 'Deal not found.' });
  const existing = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND deal_id = ?').get(req.user.id, dealId);
  if (existing) return res.json({ success: true, message: 'Already in favorites.', favorited: true });
  db.prepare('INSERT INTO favorites (id, user_id, deal_id, created_at) VALUES (?, ?, ?, ?)')
    .run(`fav_${crypto.randomUUID()}`, req.user.id, dealId, nowIso());
  return res.status(201).json({ success: true, message: 'Added to favorites.', favorited: true });
});

router.delete('/:dealId', authenticate, (req, res) => {
  const removed = db.prepare('DELETE FROM favorites WHERE user_id = ? AND deal_id = ?').run(req.user.id, req.params.dealId);
  return res.json({ success: true, message: removed.changes ? 'Removed from favorites.' : 'Not in favorites.', favorited: false });
});

export default router;

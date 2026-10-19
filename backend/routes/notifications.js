import express from 'express';
import db from '../config/db.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// In-app notifications for the signed-in user (own only). Announcements are
// fanned out into this same table at publish time so one endpoint serves all.
router.get('/', authenticate, (req, res) => {
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
  const unreadOnly = req.query.unread === '1';
  const rows = db.prepare(
    `SELECT id, type, title, message, is_read, created_at FROM notifications WHERE user_id = ? ${unreadOnly ? 'AND is_read = 0' : ''} ORDER BY created_at DESC LIMIT ?`
  ).all(req.user.id, limit);
  const unread = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).c;
  return res.json({ success: true, unread, notifications: rows.map((n) => ({ ...n, is_read: Boolean(n.is_read) })) });
});

router.patch('/:id/read', authenticate, (req, res) => {
  const updated = db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (updated.changes === 0) {
    return res.status(404).json({ success: false, message: 'Notification not found.' });
  }
  return res.json({ success: true, message: 'Marked as read.' });
});

router.post('/read-all', authenticate, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  return res.json({ success: true, message: 'All notifications marked as read.' });
});

export default router;

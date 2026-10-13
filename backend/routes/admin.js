import express from 'express';
import db from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { sanitizeText } from '../utils/helpers.js';

const router = express.Router();

router.use(authenticate, requireRole('admin'));

router.get('/statistics', (req, res) => {
  const stats = {
    total_users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    total_shops: db.prepare('SELECT COUNT(*) as c FROM shops').get().c,
    pending_applications: db.prepare('SELECT COUNT(*) as c FROM shops WHERE status = ?').get('pending').c,
    active_deals: db.prepare('SELECT COUNT(*) as c FROM deals WHERE status = ?').get('active').c,
    total_reservations: db.prepare('SELECT COUNT(*) as c FROM reservations').get().c,
    food_rescued: db.prepare('SELECT COALESCE(SUM(quantity), 0) as c FROM reservations WHERE status = ?').get('collected').c,
    total_revenue: db.prepare('SELECT COALESCE(SUM(amount), 0) as c FROM payments WHERE status = ?').get('success').c
  };

  return res.json({ success: true, statistics: stats });
});

router.get('/applications', (req, res) => {
  const rows = db.prepare('SELECT * FROM shops ORDER BY created_at DESC').all();
  return res.json({ success: true, applications: rows });
});

router.patch('/applications/:id', (req, res) => {
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.params.id);
  if (!shop) {
    return res.status(404).json({ success: false, message: 'Application not found.' });
  }

  const status = sanitizeText(req.body?.status || 'pending');
  if (!['pending', 'approved', 'rejected', 'suspended'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid application status.' });
  }

  db.prepare('UPDATE shops SET status = ? WHERE id = ?').run(status, req.params.id);
  return res.json({ success: true, message: 'Application status updated.' });
});

router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, name, email, phone, role, status, created_at FROM users ORDER BY created_at DESC').all();
  return res.json({ success: true, users });
});

router.get('/shops', (req, res) => {
  const shops = db.prepare('SELECT * FROM shops ORDER BY created_at DESC').all();
  return res.json({ success: true, shops });
});

router.get('/deals', (req, res) => {
  const deals = db.prepare('SELECT * FROM deals ORDER BY created_at DESC').all();
  return res.json({ success: true, deals });
});

export default router;

import express from 'express';
import db from '../config/db.js';
import { authenticate, optionalAuthenticate, requireRole } from '../middleware/auth.js';
import { makeId, sanitizeText, nowIso, logActivity } from '../utils/helpers.js';

const router = express.Router();

// Public: active categories for the storefront filter bar. With ?all=1 and a
// valid ADMIN token the response includes inactive rows so admins can manage
// and re-activate them.
router.get('/', optionalAuthenticate, (req, res) => {
  const withCount = req.query.with_counts === '1';
  const adminAll = req.query.all === '1' && req.user && req.user.role === 'admin';
  const sql = adminAll
    ? 'SELECT id, name, icon, status FROM categories ORDER BY name ASC'
    : "SELECT id, name, icon, status FROM categories WHERE status = 'active' ORDER BY name ASC";
  const rows = db.prepare(sql).all();
  if (withCount || adminAll) {
    // Counts are always active-only; they keep the storefront filter honest.
    const counts = db.prepare(`SELECT LOWER(category) as category, COUNT(*) as c FROM deals WHERE status = 'active' GROUP BY LOWER(category)`).all();
    const map = new Map(counts.map((c) => [c.category, c.c]));
    return res.json({ success: true, categories: rows.map((r) => ({ ...r, active_count: map.get(r.name.toLowerCase()) || 0 })) });
  }
  return res.json({ success: true, categories: rows });
});

const admin = [authenticate, requireRole('admin')];

router.post('/', ...admin, (req, res) => {
  const name = sanitizeText(req.body?.name);
  if (!name) return res.status(400).json({ success: false, message: 'Category name is required.' });
  const existing = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)').get(name);
  if (existing) return res.status(409).json({ success: false, message: 'That category already exists.' });
  const id = makeId('category');
  db.prepare('INSERT INTO categories (id, name, icon, status) VALUES (?, ?, ?, ?)').run(id, name, sanitizeText(req.body?.icon || ''), 'active');
  logActivity({ actorId: req.user.id, actorRole: req.user.role, action: 'category.create', targetType: 'category', targetId: id, metadata: { name } });
  return res.status(201).json({ success: true, message: 'Category created.', category: db.prepare('SELECT * FROM categories WHERE id = ?').get(id) });
});

router.patch('/:id', ...admin, (req, res) => {
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!category) return res.status(404).json({ success: false, message: 'Category not found.' });
  const status = sanitizeText(req.body?.status);
  if (status && !['active', 'inactive'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Status must be "active" or "inactive".' });
  }
  const name = sanitizeText(req.body?.name) || category.name;
  const icon = req.body?.icon !== undefined ? sanitizeText(req.body.icon) : category.icon;
  db.prepare('UPDATE categories SET name = ?, icon = ?, status = ? WHERE id = ?')
    .run(name, icon, status || category.status, req.params.id);
  logActivity({ actorId: req.user.id, actorRole: req.user.role, action: 'category.update', targetType: 'category', targetId: req.params.id, metadata: { name, status: status || category.status } });
  return res.json({ success: true, message: 'Category updated.', category: db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id) });
});

export default router;

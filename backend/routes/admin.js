import express from 'express';
import crypto from 'crypto';
import db from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { sanitizeText, nowIso, logActivity, notifyUsers, audienceUserIds } from '../utils/helpers.js';

const router = express.Router();

router.use(authenticate, requireRole('admin'));

// ---------------------------------------------------------------------------
// Overview statistics — honest, labelled metrics. Reserved value is an
// ESTIMATE (no money has moved); completed pickups are the only realized
// marketplace activity we count.
// ---------------------------------------------------------------------------
router.get('/statistics', (_req, res) => {
  const one = (sql, ...p) => db.prepare(sql).get(...p).c;
  const collectedValue = one(`SELECT COALESCE(SUM(total_amount), 0) as c FROM reservations WHERE status = 'collected'`);
  const reservedValue = one(`SELECT COALESCE(SUM(total_amount), 0) as c FROM reservations WHERE status = 'reserved'`);

  const stats = {
    users_total: one('SELECT COUNT(*) as c FROM users'),
    users_active: one(`SELECT COUNT(*) as c FROM users WHERE status = 'active'`),
    users_suspended: one(`SELECT COUNT(*) as c FROM users WHERE status = 'suspended'`),
    users_suspended_disabled: one(`SELECT COUNT(*) as c FROM users WHERE status IN ('suspended','disabled')`),
    customers: one(`SELECT COUNT(*) as c FROM users WHERE role = 'customer'`),
    shop_owners: one(`SELECT COUNT(*) as c FROM users WHERE role = 'shop_owner'`),
    shops_total: one('SELECT COUNT(*) as c FROM shops'),
    shops_pending: one(`SELECT COUNT(*) as c FROM shops WHERE status = 'pending'`),
    shops_approved: one(`SELECT COUNT(*) as c FROM shops WHERE status = 'approved'`),
    shops_suspended: one(`SELECT COUNT(*) as c FROM shops WHERE status = 'suspended'`),
    listings_total: one('SELECT COUNT(*) as c FROM deals'),
    listings_active: one(`SELECT COUNT(*) as c FROM deals WHERE status = 'active' AND expires_at > ?`, nowIso()),
    listings_paused: one(`SELECT COUNT(*) as c FROM deals WHERE status = 'paused'`),
    listings_expired: one(`SELECT COUNT(*) as c FROM deals WHERE status = 'expired'`),
    reservations_total: one('SELECT COUNT(*) as c FROM reservations'),
    reservations_active: one(`SELECT COUNT(*) as c FROM reservations WHERE status = 'reserved' AND expires_at > ?`, nowIso()),
    reservations_collected: one(`SELECT COUNT(*) as c FROM reservations WHERE status = 'collected'`),
    reservations_cancelled: one(`SELECT COUNT(*) as c FROM reservations WHERE status = 'cancelled'`),
    reservations_expired: one(`SELECT COUNT(*) as c FROM reservations WHERE status = 'expired'`),
    pickup_completed: one(`SELECT COUNT(*) as c FROM reservations WHERE status = 'collected'`),
    units_rescued: one(`SELECT COALESCE(SUM(quantity), 0) as c FROM reservations WHERE status = 'collected'`),
    // Estimates in ZMW, clearly labelled — nothing here is revenue.
    estimated_reserved_value: Number(reservedValue) || 0,
    estimated_collected_value: Number(collectedValue) || 0
  };
  return res.json({ success: true, statistics: stats });
});

// ---------------------------------------------------------------------------
// Vendor (shop) management. Approving an orphan (guest) application links the
// owner by matching the users.email, creating the account linkage that used
// to be missing.
// ---------------------------------------------------------------------------
router.get('/vendors', (req, res) => {
  const status = sanitizeText(req.query.status);
  let sql = `
    SELECT s.*, u.name as owner_name, u.email as owner_email, u.status as owner_status,
      (SELECT COUNT(*) FROM deals d WHERE d.shop_id = s.id) as listings_total,
      (SELECT COUNT(*) FROM deals d WHERE d.shop_id = s.id AND d.status = 'active') as listings_active
    FROM shops s LEFT JOIN users u ON u.id = s.owner_id`;
  const params = [];
  if (status && ['pending', 'approved', 'rejected', 'suspended'].includes(status)) {
    sql += ' WHERE s.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY CASE s.status WHEN \'pending\' THEN 0 ELSE 1 END, s.created_at DESC';
  return res.json({ success: true, vendors: db.prepare(sql).all(...params) });
});

router.patch('/vendors/:id/status', (req, res) => {
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.params.id);
  if (!shop) {
    return res.status(404).json({ success: false, message: 'Vendor application not found.' });
  }

  const status = sanitizeText(req.body?.status || '');
  if (!['approved', 'rejected', 'suspended', 'pending'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Status must be one of: approved, rejected, suspended, pending.' });
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE shops SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), shop.id);

    // Approving an application activates its pending owner account whether
    // the shop was created WITH an owner (onboarding wizard) or the owner is
    // linked at approval time (legacy orphan application by email match).
    if (status === 'approved') {
      let ownerId = shop.owner_id;
      if (!ownerId && shop.email) {
        const candidate = db.prepare(`SELECT id, role FROM users WHERE email = ?`).get(String(shop.email).toLowerCase());
        if (candidate && candidate.role === 'shop_owner') {
          ownerId = candidate.id;
          db.prepare('UPDATE shops SET owner_id = ? WHERE id = ?').run(ownerId, shop.id);
        }
      }
      if (ownerId) {
        const owner = db.prepare('SELECT id, status FROM users WHERE id = ?').get(ownerId);
        if (owner && owner.status === 'pending') {
          db.prepare(`UPDATE users SET status = 'active', updated_at = ? WHERE id = ?`).run(nowIso(), ownerId);
        }
        notifyUsers([ownerId], { type: 'vendor_status', title: 'Shop approved 🎉', message: `${shop.name} has been approved. You can now publish listings.` });
      }
    }
    if (status === 'suspended' && shop.owner_id) {
      notifyUsers([shop.owner_id], { type: 'vendor_status', title: 'Shop suspended', message: `${shop.name} has been suspended by an administrator. Listings are paused and new reservations are blocked.` });
    }
    if (status === 'rejected' && shop.owner_id) {
      notifyUsers([shop.owner_id], { type: 'vendor_status', title: 'Application rejected', message: `${shop.name}'s application was not approved this time. You may update details and reapply.` });
    }

    // Suspended shops: no NEW business. Existing reservations stay untouched
    // (they are handled per rules in reservations.js), listings pause only if
    // still active so they leave the marketplace immediately.
    if (status === 'suspended') {
      db.prepare(`UPDATE deals SET status = 'paused', updated_at = ? WHERE shop_id = ? AND status = 'active'`).run(nowIso(), shop.id);
    }
  });
  tx();

  logActivity({ actorId: req.user.id, actorRole: req.user.role, action: 'vendor.status', targetType: 'shop', targetId: shop.id, metadata: { from: shop.status, to: status } });
  return res.json({ success: true, message: `Vendor status updated to ${status}.` });
});

// ---------------------------------------------------------------------------
// Customer management — never exposes password hashes; suspension preferred
// over deletion; admins are protected (no one may suspend/disable an admin).
// ---------------------------------------------------------------------------
router.get('/users', (req, res) => {
  const q = sanitizeText(req.query.q);
  const role = sanitizeText(req.query.role);
  const status = sanitizeText(req.query.status);
  let sql = `SELECT id, name, email, phone, role, status, created_at FROM users WHERE 1=1`;
  const params = [];
  if (q) { sql += ' AND (LOWER(name) LIKE ? OR LOWER(email) LIKE ?)'; params.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`); }
  if (role && ['customer', 'shop_owner', 'admin'].includes(role)) { sql += ' AND role = ?'; params.push(role); }
  if (status && ['active', 'pending', 'suspended', 'disabled'].includes(status)) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Math.max(1, Math.min(200, Number(req.query.limit) || 100)));
  return res.json({ success: true, users: db.prepare(sql).all(...params) });
});

router.patch('/users/:id/status', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) {
    return res.status(404).json({ success: false, message: 'User not found.' });
  }
  const status = sanitizeText(req.body?.status);
  if (!['active', 'suspended', 'disabled'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Status must be active, suspended or disabled.' });
  }
  if (target.role === 'admin') {
    return res.status(403).json({ success: false, message: 'Administrator accounts cannot be suspended or disabled (lockout protection).' });
  }
  if (target.id === req.user.id) {
    return res.status(400).json({ success: false, message: 'You cannot change your own status here.' });
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), target.id);
    // Suspending a shop owner also pauses their shop and active listings so
    // marketplace availability reflects the suspension immediately.
    if (status !== 'active' && target.role === 'shop_owner') {
      const shop = db.prepare('SELECT * FROM shops WHERE owner_id = ?').get(target.id);
      if (shop) {
        db.prepare('UPDATE shops SET status = ?, updated_at = ? WHERE id = ?').run('suspended', nowIso(), shop.id);
        db.prepare(`UPDATE deals SET status = 'paused', updated_at = ? WHERE shop_id = ? AND status = 'active'`).run(nowIso(), shop.id);
      }
    }
  });
  tx();

  notifyUsers([target.id], {
    type: 'account',
    title: status === 'active' ? 'Account restored' : 'Account ' + status,
    message: status === 'active'
      ? 'Your account is active again. Welcome back!'
      : 'Your account was updated by an administrator. Contact support if you believe this is a mistake.'
  });
  logActivity({ actorId: req.user.id, actorRole: req.user.role, action: 'user.status', targetType: 'user', targetId: target.id, metadata: { from: target.status, to: status } });
  return res.json({ success: true, message: `User status updated to ${status}.` });
});

// ---------------------------------------------------------------------------
// Listing + reservation moderation.
// ---------------------------------------------------------------------------
router.get('/deals', (req, res) => {
  const status = sanitizeText(req.query.status);
  let sql = `
    SELECT d.*, s.name as shop_name FROM deals d
    LEFT JOIN shops s ON s.id = d.shop_id`;
  const params = [];
  if (status && ['active', 'paused', 'expired', 'cancelled', 'sold_out'].includes(status)) { sql += ' WHERE d.status = ?'; params.push(status); }
  sql += ' ORDER BY d.created_at DESC LIMIT ?';
  params.push(Math.max(1, Math.min(200, Number(req.query.limit) || 100)));
  return res.json({ success: true, deals: db.prepare(sql).all(...params) });
});

router.patch('/deals/:id/status', (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ success: false, message: 'Deal not found.' });
  const status = sanitizeText(req.body?.status);
  if (!['active', 'paused', 'expired', 'cancelled'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Status must be one of: active, paused, expired, cancelled.' });
  }
  db.prepare('UPDATE deals SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), deal.id);
  logActivity({ actorId: req.user.id, actorRole: req.user.role, action: 'deal.moderate', targetType: 'deal', targetId: deal.id, metadata: { from: deal.status, to: status } });
  return res.json({ success: true, message: `Listing status updated to ${status}.` });
});

router.get('/reservations', (req, res) => {
  const status = sanitizeText(req.query.status);
  let sql = `
    SELECT r.*, d.food_name, s.name as shop_name, u.name as customer_name, u.email as customer_email
    FROM reservations r
    LEFT JOIN deals d ON d.id = r.deal_id
    LEFT JOIN shops s ON s.id = r.shop_id
    LEFT JOIN users u ON u.id = r.user_id`;
  const params = [];
  if (status && ['reserved', 'collected', 'cancelled', 'expired'].includes(status)) { sql += ' WHERE r.status = ?'; params.push(status); }
  sql += ' ORDER BY r.created_at DESC LIMIT ?';
  params.push(Math.max(1, Math.min(200, Number(req.query.limit) || 100)));
  return res.json({ success: true, reservations: db.prepare(sql).all(...params).map((r) => ({ ...r, total_amount: Number(r.total_amount) })) });
});

// ---------------------------------------------------------------------------
// Activity log + announcements.
// ---------------------------------------------------------------------------
router.get('/activity', (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 100));
  const rows = db.prepare(`
    SELECT a.id, a.action, a.target_type, a.target_id, a.metadata, a.created_at, a.actor_role,
           u.name as actor_name, u.email as actor_email
    FROM activity_logs a LEFT JOIN users u ON u.id = a.actor_id
    ORDER BY a.created_at DESC LIMIT ?`).all(limit);
  return res.json({ success: true, activity: rows.map((r) => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null })) });
});

router.get('/announcements', (_req, res) => {
  const rows = db.prepare(`
    SELECT an.*, u.name as created_by_name FROM announcements an
    LEFT JOIN users u ON u.id = an.created_by_admin_id
    ORDER BY an.created_at DESC LIMIT 100`).all();
  return res.json({ success: true, announcements: rows });
});

router.post('/announcements', (req, res) => {
  const title = sanitizeText(req.body?.title);
  const body = sanitizeText(req.body?.body);
  const audience = sanitizeText(req.body?.audience || 'all');
  if (!title || !body) return res.status(400).json({ success: false, message: 'Title and body are required.' });
  if (!['all', 'customers', 'shop_owners'].includes(audience)) {
    return res.status(400).json({ success: false, message: 'Audience must be all, customers or shop_owners.' });
  }
  const announcementId = makeAnnId();
  db.prepare('INSERT INTO announcements (id, created_by_admin_id, title, body, audience, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(announcementId, req.user.id, title, body, audience, 'published', nowIso());

  notifyUsers(audienceUserIds(audience), { type: 'announcement', title: `Announcement: ${title}`, message: body });
  logActivity({ actorId: req.user.id, actorRole: req.user.role, action: 'announcement.publish', targetType: 'announcement', targetId: announcementId, metadata: { audience } });
  return res.status(201).json({ success: true, message: 'Announcement published.', announcement: db.prepare('SELECT * FROM announcements WHERE id = ?').get(announcementId) });
});

router.patch('/announcements/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, message: 'Announcement not found.' });
  const status = sanitizeText(req.body?.status);
  if (!['published', 'archived'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Status must be published or archived.' });
  }
  db.prepare('UPDATE announcements SET status = ? WHERE id = ?').run(status, req.params.id);
  logActivity({ actorId: req.user.id, actorRole: req.user.role, action: 'announcement.archive', targetType: 'announcement', targetId: req.params.id });
  return res.json({ success: true, message: `Announcement ${status}.` });
});

function makeAnnId() {
  return `ann_${crypto.randomUUID()}`;
}

export default router;

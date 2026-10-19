import express from 'express';
import path from 'path';
import fs from 'fs';
import db from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { makeId, sanitizeText, calculateDiscount, nowIso, logActivity } from '../utils/helpers.js';
import { validateDealInput } from '../utils/validation.js';
import { uploadImages, removeUploadFile, sniffImageType } from '../utils/uploads.js';

const router = express.Router();

const SORTS = {
  ending_soon: 'd.expires_at ASC',
  newest: 'd.created_at DESC',
  price_asc: 'd.discounted_price ASC',
  price_desc: 'd.discounted_price DESC',
  discount: 'd.discount_percentage DESC'
};

/**
 * Canonical deal DTO. Local uploads take precedence over external URLs so the
 * presentation keeps working offline; both consumers (website + Android) load
 * relative /uploads/... paths through THEIR configured API origin.
 */
function normalizeDeal(deal) {
  return {
    ...deal,
    original_price: Number(deal.original_price),
    discounted_price: Number(deal.discounted_price),
    quantity: Number(deal.quantity),
    quantity_remaining: Number(deal.quantity_remaining),
    discount_percentage: Number(deal.discount_percentage || 0),
    image_url: deal.image_path ? `/uploads/products/${path.basename(String(deal.image_path))}` : (deal.image_url || '')
  };
}

const userShop = (userId) => db.prepare('SELECT * FROM shops WHERE owner_id = ?').get(userId);

// ---------------------------------------------------------------------------
// Public catalog: active, non-expired listings from approved shops only.
// Optional search/filter/sort/pagination params (website + Android share them):
//   q, category, vendor (shop id or owner name substring), sort, page, limit,
//   available=1 (only listings with remaining stock).
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  const now = nowIso();
  const q = sanitizeText(req.query.q);
  const category = sanitizeText(req.query.category);
  const vendor = sanitizeText(req.query.vendor);
  const availableOnly = req.query.available === '1';
  const sort = SORTS[req.query.sort] || SORTS.ending_soon;

  const where = ["d.status = 'active'", 'd.expires_at > ?', "s.status = 'approved'"];
  const params = [now];
  if (q) {
    where.push('(LOWER(d.food_name) LIKE ? OR LOWER(d.description) LIKE ? OR LOWER(s.name) LIKE ?)');
    params.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
  }
  if (category && category !== 'all') {
    where.push('LOWER(d.category) = ?');
    params.push(category.toLowerCase());
  }
  if (vendor) {
    where.push('(LOWER(s.name) LIKE ? OR d.shop_id = ?)');
    params.push(`%${vendor.toLowerCase()}%`, vendor);
  }
  if (availableOnly) where.push('d.quantity_remaining > 0');

  const limit = Math.max(1, Math.min(60, Number(req.query.limit) || 60));
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * limit;

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = db.prepare(
    `SELECT COUNT(*) AS c FROM deals d JOIN shops s ON s.id = d.shop_id ${whereSql}`
  ).get(...params).c;

  const rows = db.prepare(`
    SELECT d.*, s.name as shop_name, s.email as shop_email, s.city, s.area, s.address, s.logo_path
    FROM deals d
    JOIN shops s ON s.id = d.shop_id
    ${whereSql}
    ORDER BY ${sort}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return res.json({
    success: true,
    total,
    page,
    limit,
    deals: rows.map(normalizeDeal)
  });
});

// Convenience alias used by the website dashboard: the caller's own listings.
router.get('/mine', authenticate, requireRole('shop_owner', 'admin'), (req, res) => {
  const shop = userShop(req.user.id);
  if (!shop) return res.json({ success: true, deals: [] });
  const rows = db.prepare(`
    SELECT d.* FROM deals d WHERE d.shop_id = ?
    ORDER BY CASE d.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, d.created_at DESC
  `).all(shop.id);
  return res.json({ success: true, shop: { id: shop.id, name: shop.name, status: shop.status }, deals: rows.map(normalizeDeal) });
});

router.get('/:id', (req, res) => {
  const deal = db.prepare(`
    SELECT d.*, s.name as shop_name, s.city, s.area, s.address, s.phone as shop_phone, s.logo_path
    FROM deals d JOIN shops s ON s.id = d.shop_id WHERE d.id = ?`).get(req.params.id);
  if (!deal) {
    return res.status(404).json({ success: false, message: 'Deal not found.' });
  }
  return res.json({ success: true, deal: normalizeDeal(deal) });
});

// ---------------------------------------------------------------------------
// Create listing. Publishing requires an APPROVED shop (pending vendors can
// complete profiles and read everything, but cannot publish); suspended
// shops/users are blocked. Admin may pass an explicit shop_id to create on
// behalf of a shop.
// ---------------------------------------------------------------------------
const dealUpload = uploadImages('products');

router.post('/', authenticate, requireRole('shop_owner', 'admin'), dealUpload.single('image'), (req, res) => {
  const body = { ...(req.body || {}) };
  const shop = req.user.role === 'admin'
    ? (req.body.shop_id ? db.prepare('SELECT * FROM shops WHERE id = ?').get(req.body.shop_id) : null)
    : userShop(req.user.id);

  if (!shop) {
    return res.status(403).json({ success: false, message: 'You must own an approved shop to create deals.' });
  }
  if (req.user.role !== 'admin' && shop.status !== 'approved') {
    return res.status(403).json({ success: false, message: 'Your shop must be approved before you can publish listings.' });
  }

  const validation = validateDealInput({
    food_name: body.food_name,
    shop_name: shop.name,
    category: body.category,
    original_price: body.original_price,
    discounted_price: body.discounted_price,
    quantity: body.quantity,
    expires_at: body.expires_at
  });
  if (!validation.valid) {
    return res.status(400).json({ success: false, message: validation.errors[0] });
  }

  // Uploaded photo validation: sniff the first bytes, reject spoofed files.
  let imagePath = null;
  if (req.file) {
    const buf = fs.readFileSync(req.file.path);
    const sniffed = sniffImageType(buf);
    if (!sniffed) {
      removeUploadFile(`/uploads/products/${req.file.filename}`);
      return res.status(400).json({ success: false, message: 'Unsupported image content. Use a real JPEG, PNG, WebP or GIF.' });
    }
    imagePath = `/uploads/products/${req.file.filename}`;
  }

  const discount = calculateDiscount(body.original_price, body.discounted_price);
  const dealId = makeId('deal');
  const deal = {
    id: dealId,
    shop_id: shop.id,
    shop_name: shop.name,
    food_name: sanitizeText(body.food_name),
    description: sanitizeText(body.description || ''),
    category: sanitizeText(body.category || 'Other'),
    original_price: Number(body.original_price),
    discounted_price: Number(body.discounted_price),
    discount_percentage: discount,
    quantity: Number(body.quantity),
    quantity_remaining: Number(body.quantity),
    image_url: sanitizeText(body.image_url || ''),
    image_path: imagePath,
    created_at: nowIso(),
    expires_at: new Date(body.expires_at).toISOString(),
    pickup_window_start: sanitizeText(body.pickup_window_start || ''),
    pickup_window_end: sanitizeText(body.pickup_window_end || ''),
    status: 'active'
  };

  db.prepare(`INSERT INTO deals (id, shop_id, shop_name, food_name, description, category, original_price, discounted_price, discount_percentage, quantity, quantity_remaining, image_url, image_path, created_at, expires_at, pickup_window_start, pickup_window_end, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(deal.id, deal.shop_id, deal.shop_name, deal.food_name, deal.description, deal.category, deal.original_price, deal.discounted_price, deal.discount_percentage, deal.quantity, deal.quantity_remaining, deal.image_url, deal.image_path, deal.created_at, deal.expires_at, deal.pickup_window_start, deal.pickup_window_end, deal.status);

  db.prepare('UPDATE shops SET updated_at = ? WHERE id = ?').run(nowIso(), shop.id).changes;
  logActivity({ actorId: req.user.id, actorRole: req.user.role, action: 'deal.create', targetType: 'deal', targetId: dealId, metadata: { food_name: deal.food_name, shop_id: shop.id } });

  const saved = db.prepare(`SELECT d.* FROM deals d WHERE d.id = ?`).get(dealId);
  return res.status(201).json({ success: true, message: 'Deal created successfully.', deal: normalizeDeal(saved) });
});

// Replace the listing photo (results upload; deletes the replaced file).
router.post('/:id/images', authenticate, requireRole('shop_owner', 'admin'), dealUpload.single('image'), (req, res) => {
  const existing = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!existing) {
    if (req.file) removeUploadFile(`/uploads/products/${req.file.filename}`);
    return res.status(404).json({ success: false, message: 'Deal not found.' });
  }
  const shop = userShop(req.user.id);
  if (req.user.role !== 'admin' && (!shop || shop.id !== existing.shop_id)) {
    if (req.file) removeUploadFile(`/uploads/products/${req.file.filename}`);
    return res.status(403).json({ success: false, message: 'You can only edit your own deals.' });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Attach an image file under the field name "image".' });
  }
  const buf = fs.readFileSync(req.file.path);
  if (!sniffImageType(buf)) {
    removeUploadFile(`/uploads/products/${req.file.filename}`);
    return res.status(400).json({ success: false, message: 'Unsupported image content. Use a real JPEG, PNG, WebP or GIF.' });
  }

  const previous = existing.image_path;
  const imagePath = `/uploads/products/${req.file.filename}`;
  db.prepare('UPDATE deals SET image_path = ?, image_url = ?, updated_at = ? WHERE id = ?').run(imagePath, '', nowIso(), req.params.id);
  removeUploadFile(previous);

  const saved = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  return res.json({ success: true, message: 'Photo updated.', deal: normalizeDeal(saved) });
});

// Pause / re-activate a listing (owner while approved, or admin moderation).
router.patch('/:id/status', authenticate, requireRole('shop_owner', 'admin'), (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ success: false, message: 'Deal not found.' });

  const shop = userShop(req.user.id);
  if (req.user.role !== 'admin' && (!shop || shop.id !== deal.shop_id)) {
    return res.status(403).json({ success: false, message: 'You can only manage your own deals.' });
  }

  const next = sanitizeText(req.body?.status);
  if (!['active', 'paused'].includes(next)) {
    return res.status(400).json({ success: false, message: 'Status must be "active" or "paused".' });
  }
  if (next === 'active' && (deal.status === 'expired' || deal.status === 'cancelled')) {
    return res.status(400).json({ success: false, message: 'Expired or cancelled listings cannot be re-activated; create a new listing or update it first.' });
  }

  db.prepare('UPDATE deals SET status = ?, updated_at = ? WHERE id = ?').run(next, nowIso(), req.params.id);
  logActivity({ actorId: req.user.id, actorRole: req.user.role, action: 'deal.status', targetType: 'deal', targetId: deal.id, metadata: { from: deal.status, to: next } });
  const saved = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  return res.json({ success: true, message: `Listing ${next === 'active' ? 're-activated' : 'paused'}.`, deal: normalizeDeal(saved) });
});

router.put('/:id', authenticate, requireRole('shop_owner', 'admin'), (req, res) => {
  const existing = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Deal not found.' });
  }

  const shop = userShop(req.user.id);
  if (req.user.role !== 'admin' && (!shop || shop.id !== existing.shop_id)) {
    return res.status(403).json({ success: false, message: 'You can only edit your own deals.' });
  }

  const body = req.body || {};

  const updated = {
    food_name: sanitizeText(body.food_name || existing.food_name),
    description: body.description !== undefined ? sanitizeText(body.description) : existing.description,
    category: sanitizeText(body.category || existing.category),
    original_price: body.original_price !== undefined ? Number(body.original_price) : Number(existing.original_price),
    discounted_price: body.discounted_price !== undefined ? Number(body.discounted_price) : Number(existing.discounted_price),
    quantity: body.quantity !== undefined ? Number(body.quantity) : Number(existing.quantity),
    quantity_remaining: body.quantity_remaining !== undefined ? Number(body.quantity_remaining) : Number(existing.quantity_remaining),
    expires_at: body.expires_at ? new Date(body.expires_at).toISOString() : existing.expires_at,
    pickup_window_start: body.pickup_window_start !== undefined ? sanitizeText(body.pickup_window_start) : existing.pickup_window_start,
    pickup_window_end: body.pickup_window_end !== undefined ? sanitizeText(body.pickup_window_end) : existing.pickup_window_end,
    // image/image_url changes go through POST /:id/images only.
    image_url: existing.image_url,
    image_path: existing.image_path,
    status: existing.status
  };

  const dealCheck = validateDealInput({
    food_name: updated.food_name,
    shop_name: existing.shop_name,
    category: updated.category,
    original_price: updated.original_price,
    discounted_price: updated.discounted_price,
    quantity: updated.quantity,
    expires_at: updated.expires_at
  });
  if (!dealCheck.valid) {
    return res.status(400).json({ success: false, message: dealCheck.errors[0] });
  }

  if (!Number.isInteger(updated.quantity) || updated.quantity < 0 ||
      !Number.isInteger(updated.quantity_remaining) || updated.quantity_remaining < 0 ||
      updated.quantity_remaining > updated.quantity) {
    return res.status(400).json({ success: false, message: 'Quantities must be whole numbers, and remaining stock cannot exceed total quantity.' });
  }

  // Invariants around stock and lifecycle:
  //  - restocking a sold-out listing re-activates it (while before expiry);
  //  - discount stat stays consistent;
  //  - status never changes through PUT (PATCH /status governs active/paused).
  if (updated.quantity_remaining === 0 && updated.status === 'active') {
    updated.status = 'sold_out';
  }
  if (updated.quantity_remaining > 0 && updated.status === 'sold_out') {
    updated.status = new Date(updated.expires_at).getTime() > Date.now() ? 'active' : 'expired';
  }
  updated.discount_percentage = calculateDiscount(updated.original_price, updated.discounted_price);

  db.prepare(`UPDATE deals SET food_name = ?, description = ?, category = ?, original_price = ?, discounted_price = ?, discount_percentage = ?, quantity = ?, quantity_remaining = ?, expires_at = ?, pickup_window_start = ?, pickup_window_end = ?, status = ?, updated_at = ? WHERE id = ?`)
    .run(updated.food_name, updated.description, updated.category, updated.original_price, updated.discounted_price, updated.discount_percentage, updated.quantity, updated.quantity_remaining, updated.expires_at, updated.pickup_window_start, updated.pickup_window_end, updated.status, nowIso(), req.params.id);

  logActivity({ actorId: req.user.id, actorRole: req.user.role, action: 'deal.update', targetType: 'deal', targetId: req.params.id });
  const saved = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  return res.json({ success: true, message: 'Deal updated.', deal: normalizeDeal(saved) });
});

router.delete('/:id', authenticate, requireRole('shop_owner', 'admin'), (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) {
    return res.status(404).json({ success: false, message: 'Deal not found.' });
  }

  if (req.user.role !== 'admin') {
    const shop = userShop(req.user.id);
    if (!shop || shop.id !== deal.shop_id) {
      return res.status(403).json({ success: false, message: 'You can only delete your own deals.' });
    }
  }

  db.prepare('UPDATE deals SET status = ?, updated_at = ? WHERE id = ?').run('cancelled', nowIso(), req.params.id);
  logActivity({ actorId: req.user.id, actorRole: req.user.role, action: 'deal.cancel', targetType: 'deal', targetId: req.params.id });
  return res.json({ success: true, message: 'Deal cancelled.' });
});

export default router;

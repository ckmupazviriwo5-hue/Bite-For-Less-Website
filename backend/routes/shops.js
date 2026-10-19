import express from 'express';
import fs from 'fs';
import db from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { makeId, sanitizeText, nowIso, logActivity, notifyUsers } from '../utils/helpers.js';
import { uploadImages, removeUploadFile, sniffImageType } from '../utils/uploads.js';

const router = express.Router();

const PUBLIC_COLUMNS = 'id, name, city, area, address, description, business_type, opening_hours, pickup_instructions, pickup_window_start, pickup_window_end, logo_path, cover_image_path, status, created_at';

function publicShop(row) {
  if (!row) return null;
  return {
    ...row,
    logo_path: row.logo_path || '',
    cover_image_path: row.cover_image_path || ''
  };
}

// Guest/top-level application ORphan flow is kept for compatibility: shops
// created here have no owner until an admin links one by email on approval.
router.post('/apply', (req, res) => {
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
    db.prepare('INSERT INTO shops (id, owner_id, name, email, phone, address, city, business_info, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(shopId, null, sanitizeText(body.shop_name), sanitizeText(body.email).toLowerCase(), sanitizeText(body.phone), sanitizeText(body.address), sanitizeText(body.city || ''), sanitizeText(body.business_info || ''), 'pending');
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to submit the application. Please try again.' });
  }
  logActivity({ action: 'shop.apply_guest', targetType: 'shop', targetId: shopId, metadata: { shop_name: sanitizeText(body.shop_name) } });

  return res.status(201).json({ success: true, message: 'Shop application submitted successfully.' });
});

function requireMyShop(req, res) {
  const shop = db.prepare('SELECT * FROM shops WHERE owner_id = ?').get(req.user.id);
  if (!shop) {
    res.status(404).json({ success: false, message: 'No shop record found for this account.' });
    return null;
  }
  return shop;
}

// Vendor onboarding/approval status is readable while pending.
router.get('/me', authenticate, requireRole('shop_owner', 'admin'), (req, res) => {
  const shop = requireMyShop(req, res);
  if (!shop) return;
  return res.json({ success: true, shop });
});

// Dashboard summary scoped to the authenticated owner's shop only.
router.get('/me/dashboard', authenticate, requireRole('shop_owner', 'admin'), (req, res) => {
  const shop = requireMyShop(req, res);
  if (!shop) return;
  const listingCounts = db.prepare(`SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) as paused,
      SUM(CASE WHEN status = 'sold_out' THEN 1 ELSE 0 END) as sold_out
    FROM deals WHERE shop_id = ?`).get(shop.id);
  const resCounts = db.prepare(`SELECT
      SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END) as incoming,
      SUM(CASE WHEN status = 'collected' THEN 1 ELSE 0 END) as collected,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
      SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired
    FROM reservations WHERE shop_id = ?`).get(shop.id);
  const estReservedValue = db.prepare(`SELECT COALESCE(SUM(total_amount), 0) as v
      FROM reservations WHERE shop_id = ? AND status = 'reserved'`).get(shop.id).v;
  const estCollectedValue = db.prepare(`SELECT COALESCE(SUM(total_amount), 0) as v
      FROM reservations WHERE shop_id = ? AND status = 'collected'`).get(shop.id).v;
  const lowStock = db.prepare(`SELECT id, food_name, quantity_remaining FROM deals WHERE shop_id = ? AND status = 'active' AND quantity_remaining <= 3 ORDER BY quantity_remaining ASC LIMIT 5`).all(shop.id);

  return res.json({
    success: true,
    shop: { id: shop.id, name: shop.name, status: shop.status, city: shop.city },
    statistics: {
      listings_total: listingCounts.total || 0,
      listings_active: listingCounts.active || 0,
      listings_paused: listingCounts.paused || 0,
      listings_sold_out: listingCounts.sold_out || 0,
      reservations_incoming: resCounts.incoming || 0,
      pickup_completed: resCounts.collected || 0,
      reservations_cancelled: resCounts.cancelled || 0,
      reservations_expired: resCounts.expired || 0,
      // Labelled estimates only: no money has actually moved until pickup.
      estimated_reserved_value: Number(estReservedValue) || 0,
      estimated_collected_value: Number(estCollectedValue) || 0
    },
    low_stock: lowStock
  });
});

const EDITABLE_FIELDS = ['name', 'email', 'phone', 'address', 'city', 'area', 'business_type', 'description', 'whatsapp_number', 'opening_hours', 'pickup_instructions', 'pickup_window_start', 'pickup_window_end'];

router.patch('/me', authenticate, requireRole('shop_owner', 'admin'), (req, res) => {
  const shop = requireMyShop(req, res);
  if (!shop) return;
  const body = req.body || {};
  const sets = [];
  const values = [];
  for (const field of EDITABLE_FIELDS) {
    if (body[field] !== undefined) {
      sets.push(`${field} = ?`);
      values.push(sanitizeText(body[field]));
    }
  }
  if (!sets.length) {
    return res.status(400).json({ success: false, message: 'No editable fields supplied.' });
  }
  sets.push('updated_at = ?');
  values.push(nowIso());
  values.push(shop.id);
  db.prepare(`UPDATE shops SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  // deal.shop_name stays denormalised for catalog display; keep it in sync.
  if (body.name !== undefined) {
    db.prepare('UPDATE deals SET shop_name = ? WHERE shop_id = ?').run(sanitizeText(body.name), shop.id);
  }
  const updated = db.prepare('SELECT * FROM shops WHERE id = ?').get(shop.id);
  return res.json({ success: true, message: 'Business profile updated.', shop: updated });
});

const logoUpload = uploadImages('logos');
const coverUpload = uploadImages('covers');

function handleShopImage(kind, column) {
  return [
    authenticate,
    requireRole('shop_owner', 'admin'),
    (kind === 'logos' ? logoUpload : coverUpload).single('image'),
    (req, res) => {
      const shop = requireMyShop(req, res);
      if (!shop) return;
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Attach an image file under the field name "image".' });
      }
      const buf = fs.readFileSync(req.file.path);
      if (!sniffImageType(buf)) {
        removeUploadFile(`/uploads/${kind}/${req.file.filename}`);
        return res.status(400).json({ success: false, message: 'Unsupported image content. Use a real JPEG, PNG, WebP or GIF.' });
      }
      const previous = shop[column];
      const publicPath = `/uploads/${kind}/${req.file.filename}`;
      db.prepare(`UPDATE shops SET ${column} = ?, updated_at = ? WHERE id = ?`).run(publicPath, nowIso(), shop.id);
      removeUploadFile(previous);
      return res.json({ success: true, message: kind === 'logos' ? 'Logo updated.' : 'Cover photo updated.', path: publicPath });
    }
  ];
}

router.post('/me/logo', ...handleShopImage('logos', 'logo_path'));
router.post('/me/cover', ...handleShopImage('covers', 'cover_image_path'));

// Shop-shaped alias for Android/vendor reading of incoming reservations.
router.get('/me/reservations', authenticate, requireRole('shop_owner', 'admin'), (req, res) => {
  const shop = requireMyShop(req, res);
  if (!shop) return;
  const status = sanitizeText(req.query.status);
  let sql = `
    SELECT r.*, d.food_name, u.name as customer_name
    FROM reservations r
    LEFT JOIN deals d ON d.id = r.deal_id
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.shop_id = ?`;
  const params = [shop.id];
  if (status && ['reserved', 'collected', 'cancelled', 'expired'].includes(status)) {
    sql += ' AND r.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY CASE r.status WHEN \'reserved\' THEN 0 ELSE 1 END, r.created_at DESC LIMIT ?';
  params.push(Math.max(1, Math.min(200, Number(req.query.limit) || 100)));
  const rows = db.prepare(sql).all(...params).map((r) => ({ ...r, total_amount: Number(r.total_amount) }));
  return res.json({ success: true, reservations: rows });
});

// Public listing of approved shops (rich profile for vendor cards).
router.get('/', (req, res) => {
  const approvedOnly = req.query.all !== '1';
  const sql = `SELECT ${PUBLIC_COLUMNS} FROM shops ${approvedOnly ? "WHERE status = 'approved'" : ''} ORDER BY name ASC LIMIT 200`;
  return res.json({ success: true, shops: db.prepare(sql).all().map(publicShop) });
});

router.get('/:id', (req, res) => {
  const shop = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM shops WHERE id = ?`).get(req.params.id);
  if (!shop) {
    return res.status(404).json({ success: false, message: 'Shop not found.' });
  }
  return res.json({ success: true, shop: publicShop(shop) });
});

export default router;

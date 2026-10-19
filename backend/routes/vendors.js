import express from 'express';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../config/db.js';
import { config } from '../config/env.js';
import { authenticate, requireRole, myShop } from '../middleware/auth.js';
import { makeId, sanitizeText } from '../utils/helpers.js';
import { isValidEmail, isValidPassword, hasRequiredFields } from '../utils/validation.js';
import { uploadImages, removeUploadFile, sniffImageType } from '../utils/uploads.js';

const router = express.Router();

export function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email }, config.jwtSecret, { expiresIn: '7d' });
}

// Multi-step shop-owner onboarding (single canonical submit). Works for plain
// JSON payloads; creates the owner account + shop application in ONE
// transaction. The vendor is signed in immediately with role shop_owner and
// status pending — no public publishing until admin approval.
export function registerShopOwner(body, res) {
  const required = ['owner_name', 'shop_name', 'email', 'phone', 'address', 'password'];
  if (!hasRequiredFields(body, required)) {
    res.status(400).json({ success: false, message: 'Complete every required onboarding field before submitting.' });
    return null;
  }
  if (!isValidEmail(body.email)) {
    res.status(400).json({ success: false, message: 'Please use a valid email address.' });
    return null;
  }
  if (!isValidPassword(body.password)) {
    res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    return null;
  }
  if (!body.agree_terms || body.agree_terms === 'false') {
    res.status(400).json({ success: false, message: 'Please agree to the listing and food-safety rules before submitting.' });
    return null;
  }

  const normalizedEmail = sanitizeText(body.email).toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    res.status(409).json({ success: false, message: 'An account with that email already exists.' });
    return null;
  }

  const user = {
    id: makeId('shop'),
    name: sanitizeText(body.owner_name),
    email: normalizedEmail,
    phone: sanitizeText(body.phone),
    password_hash: bcrypt.hashSync(body.password, 10),
    role: 'shop_owner',
    status: 'pending'
  };
  const shopDescription = sanitizeText(body.description || body.business_info || '');

  try {
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO users (id, name, email, phone, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(user.id, user.name, user.email, user.phone, user.password_hash, user.role, user.status);
      db.prepare(`INSERT INTO shops (id, owner_id, name, email, phone, whatsapp_number, business_type, description, address, city, area, opening_hours, pickup_instructions, pickup_window_start, pickup_window_end, business_info, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
        .run(makeId('shop_record'), user.id, sanitizeText(body.shop_name), normalizedEmail, user.phone,
          sanitizeText(body.whatsapp_number || ''), sanitizeText(body.business_type || ''), shopDescription,
          sanitizeText(body.address), sanitizeText(body.city || ''), sanitizeText(body.area || ''),
          sanitizeText(body.opening_hours || ''), sanitizeText(body.pickup_instructions || ''),
          sanitizeText(body.pickup_window_start || ''), sanitizeText(body.pickup_window_end || ''), shopDescription);
    });
    tx();
  } catch (error) {
    res.status(500).json({ success: false, message: 'Unable to register the shop account. Please try again.' });
    return null;
  }
  return user;
}

router.post('/register', (req, res) => {
  const user = registerShopOwner(req.body || {}, res);
  if (!user) return;
  const token = signToken(user);
  return res.status(201).json({
    success: true,
    message: 'Shop application received. It is now awaiting admin approval.',
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status }
  });
});

// ---------------------------------------------------------------- profile ---
router.get('/me', authenticate, requireRole('shop_owner', 'admin'), (req, res) => {
  const shop = myShop(req.user.id);
  if (!shop) return res.status(404).json({ success: false, message: 'No shop record found for this account.' });
  return res.json({ success: true, shop });
});

const EDITABLE_SHOP_FIELDS = [
  'name', 'phone', 'whatsapp_number', 'business_type', 'description', 'business_info',
  'address', 'city', 'area', 'opening_hours', 'pickup_instructions',
  'pickup_window_start', 'pickup_window_end'
];

export function updateMyShop(req, res) {
  const shop = myShop(req.user.id);
  if (!shop) return res.status(404).json({ success: false, message: 'No shop record found for this account.' });
  const body = req.body || {};
  const update = db.prepare('UPDATE shops SET name = ?, phone = ?, whatsapp_number = ?, business_type = ?, description = ?, business_info = ?, address = ?, city = ?, area = ?, opening_hours = ?, pickup_instructions = ?, pickup_window_start = ?, pickup_window_end = ?, updated_at = ? WHERE id = ?');
  try {
    db.transaction(() => {
      const values = EDITABLE_SHOP_FIELDS.map((f) => sanitizeText(body[f] ?? shop[f] ?? ''));
      update.run(...values, new Date().toISOString(), shop.id);
      if (body.owner_name !== undefined && sanitizeText(body.owner_name)) {
        db.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?')
          .run(sanitizeText(body.owner_name), new Date().toISOString(), req.user.id);
      }
    })();
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to save your shop profile. Please try again.' });
  }
  return res.json({ success: true, message: 'Shop profile saved.', shop: myShop(req.user.id) });
}

router.patch('/me', authenticate, requireRole('shop_owner', 'admin'), updateMyShop);

// --------------------------------------------------------------- uploads ---
// Disk-based multipart uploads mirroring shops.js: multer writes under
// backend/uploads/<kind>/ with random hex filenames, magic bytes are verified
// before the DB row changes, and superseded files are deleted. Nothing is
// executed and no client-supplied name is ever trusted.
const logoUpload = uploadImages('logos');
const coverUpload = uploadImages('covers');

function handleShopImage(kind, column) {
  return (req, res) => {
    const shop = myShop(req.user.id);
    if (!shop) return res.status(404).json({ success: false, message: 'No shop record found for this account.' });
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Attach an image file under the field name "image".' });
    }
    let buf;
    try {
      buf = fs.readFileSync(req.file.path);
    } catch {
      return res.status(500).json({ success: false, message: 'Upload failed while reading the file.' });
    }
    if (!sniffImageType(buf)) {
      removeUploadFile(`/uploads/${kind}/${req.file.filename}`);
      return res.status(400).json({ success: false, message: 'Unsupported image content. Use a real JPEG, PNG, WebP or GIF.' });
    }
    try {
      const previous = shop[column];
      const publicPath = `/uploads/${kind}/${req.file.filename}`;
      db.prepare(`UPDATE shops SET ${column} = ?, updated_at = ? WHERE id = ?`).run(publicPath, new Date().toISOString(), shop.id);
      removeUploadFile(previous);
      return res.json({
        success: true,
        message: kind === 'logos' ? 'Logo updated.' : 'Cover photo updated.',
        path: publicPath,
        url: publicPath
      });
    } catch {
      removeUploadFile(`/uploads/${kind}/${req.file.filename}`);
      return res.status(500).json({ success: false, message: 'Upload failed while saving. No image was changed.' });
    }
  };
}

router.post('/me/logo', authenticate, requireRole('shop_owner', 'admin'), logoUpload.single('image'), handleShopImage('logos', 'logo_path'));
router.post('/me/cover', authenticate, requireRole('shop_owner', 'admin'), coverUpload.single('image'), handleShopImage('covers', 'cover_image_path'));

// -------------------------------------------------------------- overview ---
// Canonical GET /api/vendors/me/dashboard (brief contract). /api/vendors/dashboard
// is kept as a compatibility alias.
function vendorDashboard(req, res) {
  const shop = myShop(req.user.id);
  if (!shop) return res.status(404).json({ success: false, message: 'No shop record found for this account.' });
  const counts = {
    listings_total: db.prepare('SELECT COUNT(*) AS c FROM deals WHERE shop_id = ?').get(shop.id).c,
    listings_active: db.prepare("SELECT COUNT(*) AS c FROM deals WHERE shop_id = ? AND status = 'active' AND expires_at > ?")
      .get(shop.id, new Date().toISOString()).c,
    reservations_active: db.prepare("SELECT COUNT(*) AS c FROM reservations WHERE shop_id = ? AND status = 'reserved'").get(shop.id).c,
    completed_pickups: db.prepare("SELECT COUNT(*) AS c FROM reservations WHERE shop_id = ? AND status = 'collected'").get(shop.id).c,
    unread_notifications: db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).c,
    // Estimated value of stock currently reserved (NOT revenue), plus realised
    // collected sales — always reported separately and labelled.
    estimated_reserved_value_zmw: db.prepare("SELECT COALESCE(SUM(total_amount), 0) AS c FROM reservations WHERE shop_id = ? AND status = 'reserved'").get(shop.id).c,
    collected_sales_zmw: db.prepare("SELECT COALESCE(SUM(total_amount), 0) AS c FROM reservations WHERE shop_id = ? AND status = 'collected'").get(shop.id).c
  };
  return res.json({ success: true, shop, counts, shop_approval: shop.status, account_status: req.user.status });
}
router.get('/dashboard', authenticate, requireRole('shop_owner', 'admin'), vendorDashboard);
router.get('/me/dashboard', authenticate, requireRole('shop_owner', 'admin'), vendorDashboard);

export default router;

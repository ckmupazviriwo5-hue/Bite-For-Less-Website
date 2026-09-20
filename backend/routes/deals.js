import express from 'express';
import db from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { makeId, sanitizeText, calculateDiscount, toNumber } from '../utils/helpers.js';
import { validateDealInput } from '../utils/validation.js';

const router = express.Router();

function normalizeDeal(deal) {
  return {
    ...deal,
    original_price: Number(deal.original_price),
    discounted_price: Number(deal.discounted_price),
    quantity: Number(deal.quantity),
    quantity_remaining: Number(deal.quantity_remaining),
    discount_percentage: Number(deal.discount_percentage || 0)
  };
}

router.get('/', (req, res) => {
  const now = new Date().toISOString();
  const rows = db.prepare(`
    SELECT d.*, s.name as shop_name, s.email as shop_email, s.city, s.address
    FROM deals d
    JOIN shops s ON s.id = d.shop_id
    WHERE d.status = 'active' AND d.expires_at > ?
    ORDER BY d.expires_at ASC
  `).all(now);

  const deals = rows.map(normalizeDeal);
  return res.json({ success: true, deals });
});

router.get('/:id', (req, res) => {
  const deal = db.prepare(`SELECT d.*, s.name as shop_name FROM deals d JOIN shops s ON s.id = d.shop_id WHERE d.id = ?`).get(req.params.id);
  if (!deal) {
    return res.status(404).json({ success: false, message: 'Deal not found.' });
  }
  return res.json({ success: true, deal: normalizeDeal(deal) });
});

router.post('/', authenticate, requireRole('shop_owner', 'admin'), (req, res) => {
  const body = req.body || {};
  const validation = validateDealInput({
    food_name: body.food_name,
    shop_name: body.shop_name,
    category: body.category,
    original_price: body.original_price,
    discounted_price: body.discounted_price,
    quantity: body.quantity,
    expires_at: body.expires_at
  });

  if (!validation.valid) {
    return res.status(400).json({ success: false, message: validation.errors[0] });
  }

  const shop = db.prepare('SELECT * FROM shops WHERE owner_id = ?').get(req.user.id);
  if (!shop) {
    return res.status(403).json({ success: false, message: 'You must own an approved shop to create deals.' });
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
    created_at: new Date().toISOString(),
    expires_at: new Date(body.expires_at).toISOString(),
    status: 'active'
  };

  db.prepare(`INSERT INTO deals (id, shop_id, shop_name, food_name, description, category, original_price, discounted_price, discount_percentage, quantity, quantity_remaining, image_url, created_at, expires_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      deal.id,
      deal.shop_id,
      deal.shop_name,
      deal.food_name,
      deal.description,
      deal.category,
      deal.original_price,
      deal.discounted_price,
      deal.discount_percentage,
      deal.quantity,
      deal.quantity_remaining,
      deal.image_url,
      deal.created_at,
      deal.expires_at,
      deal.status
    );

  return res.status(201).json({ success: true, message: 'Deal created successfully.', deal: normalizeDeal(deal) });
});

router.put('/:id', authenticate, requireRole('shop_owner', 'admin'), (req, res) => {
  const existing = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Deal not found.' });
  }

  const shop = db.prepare('SELECT * FROM shops WHERE owner_id = ?').get(req.user.id);
  if (req.user.role !== 'admin' && (!shop || shop.id !== existing.shop_id)) {
    return res.status(403).json({ success: false, message: 'You can only edit your own deals.' });
  }

  const updated = {
    ...existing,
    ...req.body,
    food_name: sanitizeText(req.body.food_name || existing.food_name),
    description: sanitizeText(req.body.description ?? existing.description),
    category: sanitizeText(req.body.category || existing.category),
    original_price: toNumber(req.body.original_price, Number(existing.original_price)),
    discounted_price: toNumber(req.body.discounted_price, Number(existing.discounted_price)),
    quantity: toNumber(req.body.quantity, Number(existing.quantity)),
    quantity_remaining: toNumber(req.body.quantity_remaining, Number(existing.quantity_remaining)),
    image_url: sanitizeText(req.body.image_url || existing.image_url),
    expires_at: req.body.expires_at ? new Date(req.body.expires_at).toISOString() : existing.expires_at,
    discount_percentage: calculateDiscount(
      toNumber(req.body.original_price, Number(existing.original_price)),
      toNumber(req.body.discounted_price, Number(existing.discounted_price))
    )
  };

  db.prepare(`UPDATE deals SET food_name = ?, description = ?, category = ?, original_price = ?, discounted_price = ?, discount_percentage = ?, quantity = ?, quantity_remaining = ?, image_url = ?, expires_at = ?, status = ? WHERE id = ?`)
    .run(updated.food_name, updated.description, updated.category, updated.original_price, updated.discounted_price, updated.discount_percentage, updated.quantity, updated.quantity_remaining, updated.image_url, updated.expires_at, updated.status, req.params.id);

  return res.json({ success: true, message: 'Deal updated.', deal: normalizeDeal(updated) });
});

router.delete('/:id', authenticate, requireRole('shop_owner', 'admin'), (req, res) => {
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) {
    return res.status(404).json({ success: false, message: 'Deal not found.' });
  }

  if (req.user.role !== 'admin') {
    const shop = db.prepare('SELECT * FROM shops WHERE owner_id = ?').get(req.user.id);
    if (!shop || shop.id !== deal.shop_id) {
      return res.status(403).json({ success: false, message: 'You can only delete your own deals.' });
    }
  }

  db.prepare('UPDATE deals SET status = ? WHERE id = ?').run('cancelled', req.params.id);
  return res.json({ success: true, message: 'Deal cancelled.' });
});

export default router;

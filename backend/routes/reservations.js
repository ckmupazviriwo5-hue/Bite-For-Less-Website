import express from 'express';
import db from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { makeId, generateReservationCode, generatePickupPin, generateQrToken, sanitizeText, toNumber, nowIso, logActivity, notifyUsers } from '../utils/helpers.js';

const router = express.Router();

const RESERVATION_JOIN = `
  SELECT r.*, d.food_name, d.discounted_price, d.expires_at as deal_expires_at, d.status as deal_status,
         s.name as shop_name, u.name as customer_name, u.email as customer_email
  FROM reservations r
  LEFT JOIN deals d ON d.id = r.deal_id
  LEFT JOIN shops s ON s.id = r.shop_id
  LEFT JOIN users u ON u.id = r.user_id`;

function enrich(row) {
  return row ? { ...row, total_amount: Number(row.total_amount), quantity: Number(row.quantity) } : row;
}

router.post('/', authenticate, (req, res) => {
  const body = req.body || {};
  const userId = req.user.id;
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(sanitizeText(body.deal_id));

  if (!deal) {
    return res.status(404).json({ success: false, message: 'Deal not found.' });
  }

  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(deal.shop_id);

  if (deal.status !== 'active') {
    if (deal.status === 'paused') {
      return res.status(400).json({ success: false, message: 'This listing is paused and cannot be reserved right now.' });
    }
    db.prepare('UPDATE deals SET status = ? WHERE id = ? AND status = ?').run('expired', deal.id, 'active');
    return res.status(400).json({ success: false, message: 'Deal has expired.' });
  }
  if (new Date(deal.expires_at).getTime() <= Date.now()) {
    db.prepare('UPDATE deals SET status = ? WHERE id = ? AND status = ?').run('expired', deal.id, 'active');
    return res.status(400).json({ success: false, message: 'Deal has expired.' });
  }
  if (shop && shop.status !== 'approved') {
    return res.status(400).json({
      success: false,
      message: shop.status === 'suspended'
        ? 'This shop is suspended — new reservations are paused.'
        : 'This shop is not currently accepting reservations.'
    });
  }

  const quantity = Number(body.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ success: false, message: 'Quantity must be a whole number of at least 1.' });
  }
  if (quantity > deal.quantity_remaining) {
    return res.status(400).json({ success: false, message: 'Not enough stock available.' });
  }

  const reservationId = makeId('reservation');
  const reservationCode = generateReservationCode();
  const pickupPin = generatePickupPin();
  const qrToken = generateQrToken();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const totalAmount = deal.discounted_price * quantity;

  const tx = db.transaction(() => {
    // Decrement happens inside the same transaction and is guarded: competing
    // requests for the last unit cannot both pass `quantity_remaining >= q`.
    db.prepare('UPDATE deals SET quantity_remaining = quantity_remaining - ? WHERE id = ? AND quantity_remaining >= ?')
      .run(quantity, deal.id, quantity);
    const updatedDeal = db.prepare('SELECT quantity_remaining FROM deals WHERE id = ?').get(deal.id);
    if (!updatedDeal || updatedDeal.quantity_remaining < 0) {
      throw new Error('Stock update failed.');
    }
    if (updatedDeal.quantity_remaining === 0) {
      db.prepare('UPDATE deals SET status = ? WHERE id = ?').run('sold_out', deal.id);
    }

    db.prepare(`INSERT INTO reservations (id, user_id, deal_id, shop_id, quantity, total_amount, reservation_code, pickup_pin, qr_token, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(reservationId, userId, deal.id, deal.shop_id, quantity, totalAmount, reservationCode, pickupPin, qrToken, 'reserved', nowIso(), expiresAt);
  });

  try {
    tx();
  } catch (error) {
    return res.status(409).json({ success: false, message: 'Unable to reserve this deal — someone was booking the last items. Please retry.' });
  }

  // Real notifications (no fake payment confirmations: no money has moved).
  notifyUsers([userId], {
    type: 'reservation',
    title: 'Reservation confirmed',
    message: `${deal.food_name} × ${quantity} confirmed. Show pickup code ${reservationCode} (PIN ${pickupPin}) within 30 minutes.`
  });
  if (shop?.owner_id) {
    notifyUsers([shop.owner_id], {
      type: 'reservation',
      title: 'New reservation',
      message: `${quantity} × ${deal.food_name} reserved by a customer (${reservationCode}).`
    });
  }
  logActivity({ actorId: userId, actorRole: req.user.role, action: 'reservation.create', targetType: 'reservation', targetId: reservationId, metadata: { deal_id: deal.id, quantity } });

  const reservation = enrich(db.prepare(`${RESERVATION_JOIN} WHERE r.id = ?`).get(reservationId));
  return res.status(201).json({
    success: true,
    message: 'Reservation confirmed. Payment on pickup — no money is transferred by this step.',
    reservation: {
      id: reservation.id,
      reservation_code: reservation.reservation_code,
      pickup_pin: reservation.pickup_pin,
      qr_token: reservation.qr_token,
      quantity: reservation.quantity,
      total_amount: reservation.total_amount,
      shop_id: reservation.shop_id,
      deal_id: reservation.deal_id,
      food_name: reservation.food_name,
      status: reservation.status,
      expires_at: reservation.expires_at
    }
  });
});

router.get('/', authenticate, (req, res) => {
  const status = sanitizeText(req.query.status);
  let sql = RESERVATION_JOIN + ' WHERE r.user_id = ?';
  const params = [req.user.id];
  if (status && ['reserved', 'collected', 'cancelled', 'expired'].includes(status)) {
    sql += ' AND r.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY r.created_at DESC LIMIT ?';
  params.push(Math.max(1, Math.min(200, Number(req.query.limit) || 100)));
  return res.json({ success: true, reservations: db.prepare(sql).all(...params).map(enrich) });
});

router.get('/:id', authenticate, (req, res) => {
  const reservation = enrich(db.prepare(RESERVATION_JOIN + ' WHERE r.id = ?').get(req.params.id));
  if (!reservation) {
    return res.status(404).json({ success: false, message: 'Reservation not found.' });
  }
  if (req.user.role !== 'admin' && reservation.user_id !== req.user.id) {
    return res.status(403).json({ success: false, message: 'You do not have access to this reservation.' });
  }
  return res.json({ success: true, reservation });
});

// Public (no PIN) reference lookup for vendors by reservation code: scoped to
// their own shop; the PIN still must match to complete collection.
router.get('/lookup/:code', authenticate, requireRole('shop_owner', 'admin'), (req, res) => {
  const code = sanitizeText(req.params.code).toUpperCase();
  let reservation = enrich(db.prepare(RESERVATION_JOIN + ' WHERE UPPER(r.reservation_code) = ?').get(code));
  if (reservation && req.user.role !== 'admin') {
    const shop = db.prepare('SELECT * FROM shops WHERE owner_id = ?').get(req.user.id);
    if (!shop || shop.id !== reservation.shop_id) reservation = null;
  }
  if (!reservation) {
    return res.status(404).json({ success: false, message: 'No reservation with that code in your shop.' });
  }
  return res.json({ success: true, reservation: { ...reservation, pickup_pin: undefined } });
});

// Pickup verification: scoped to the reservation's own shop (admin excepted).
router.post('/:id/verify', authenticate, requireRole('shop_owner', 'admin'), (req, res) => {
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!reservation) {
    return res.status(404).json({ success: false, message: 'Reservation not found.' });
  }

  if (req.user.role !== 'admin') {
    const shop = db.prepare('SELECT * FROM shops WHERE owner_id = ?').get(req.user.id);
    if (!shop || shop.id !== reservation.shop_id) {
      return res.status(403).json({ success: false, message: 'This reservation belongs to another shop.' });
    }
  }

  if (reservation.status === 'collected') {
    return res.status(400).json({ success: false, message: 'This reservation has already been collected.' });
  }
  if (reservation.status === 'cancelled' || reservation.status === 'expired') {
    return res.status(400).json({ success: false, message: 'This reservation is no longer valid.' });
  }

  const pin = sanitizeText(req.body?.pickup_pin || '');
  const token = sanitizeText(req.body?.qr_token || '');

  if (pin !== reservation.pickup_pin && token !== reservation.qr_token) {
    return res.status(401).json({ success: false, message: 'Invalid pickup verification details.' });
  }

  db.prepare('UPDATE reservations SET status = ?, collected_at = ? WHERE id = ? AND status = ?').run('collected', nowIso(), req.params.id, 'reserved');
  notifyUsers([reservation.user_id], {
    type: 'pickup',
    title: 'Pickup confirmed',
    message: `Pickup ${reservation.reservation_code} completed. Enjoy your food and consider leaving a review!`
  });
  logActivity({ actorId: req.user.id, actorRole: req.user.role, action: 'reservation.collect', targetType: 'reservation', targetId: req.params.id, metadata: { method: pin === reservation.pickup_pin ? 'pin' : 'qr' } });

  return res.json({ success: true, message: 'Reservation verified and collected.' });
});

router.post('/:id/cancel', authenticate, (req, res) => {
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!reservation) {
    return res.status(404).json({ success: false, message: 'Reservation not found.' });
  }

  if (req.user.role !== 'admin' && reservation.user_id !== req.user.id) {
    return res.status(403).json({ success: false, message: 'You cannot cancel this reservation.' });
  }

  if (reservation.status !== 'reserved') {
    return res.status(400).json({ success: false, message: 'Only active reservations can be cancelled.' });
  }

  const tx = db.transaction(() => {
    // Exactly-once: the status guard makes repeat cancels a no-op that never
    // double-restores stock; collected reservations never restore stock.
    const updated = db.prepare('UPDATE reservations SET status = ? WHERE id = ? AND status = ?')
      .run('cancelled', req.params.id, 'reserved');
    if (updated.changes === 1) {
      const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(reservation.deal_id);
      if (deal) {
        let dealStatus = deal.status;
        if (deal.status === 'sold_out') {
          dealStatus = new Date(deal.expires_at).getTime() > Date.now() ? 'active' : 'expired';
        }
        db.prepare('UPDATE deals SET quantity_remaining = quantity_remaining + ?, status = ? WHERE id = ?')
          .run(reservation.quantity, dealStatus, reservation.deal_id);
      }
    }
  });
  tx();
  if (req.user.role !== 'shop_owner') {
    const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(reservation.shop_id);
    if (shop?.owner_id) {
      notifyUsers([shop.owner_id], {
        type: 'reservation',
        title: 'Reservation cancelled',
        message: `Reservation ${reservation.reservation_code} was cancelled by the customer. Stock returned to the listing.`
      });
    }
  }
  logActivity({ actorId: req.user.id, actorRole: req.user.role, action: 'reservation.cancel', targetType: 'reservation', targetId: req.params.id });
  return res.json({ success: true, message: 'Reservation cancelled.' });
});

/**
 * Safe expiry cleanup, idempotent and exactly-once:
 *  - reserved reservations past expires_at -> expired (+ stock restored once);
 *  - active deals past expires_at -> expired.
 * Called by the server interval and exposed to tests via /api/maintenance.
 */
export function runExpirySweep() {
  const now = nowIso();
  let restored = 0;
  const tx = db.transaction(() => {
    // Reservations first (stock restore), guard makes repeats a no-op.
    const expiredRows = db.prepare(`SELECT id, deal_id, quantity FROM reservations WHERE status = 'reserved' AND expires_at <= ?`).all(now);
    const claim = db.prepare(`UPDATE reservations SET status = 'expired' WHERE id = ? AND status = 'reserved'`);
    for (const r of expiredRows) {
      if (claim.run(r.id).changes === 1) {
        const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(r.deal_id);
        if (deal) {
          let dealStatus = deal.status;
          if (deal.status === 'sold_out' || deal.status === 'active') {
            dealStatus = new Date(deal.expires_at).getTime() > Date.now() ? 'active' : 'expired';
          }
          db.prepare('UPDATE deals SET quantity_remaining = quantity_remaining + ?, status = ? WHERE id = ?')
            .run(r.quantity, dealStatus, r.deal_id);
        }
        restored += 1;
      }
    }
    db.prepare(`UPDATE deals SET status = 'expired' WHERE status = 'active' AND expires_at <= ?`).run(now);
  });
  tx();
  return { reservationsExpired: restored, at: now };
}

// Admin-scoped manual trigger for tests/tooling.
router.post('/maintenance/sweep', authenticate, requireRole('admin'), (_req, res) => {
  return res.json({ success: true, ...runExpirySweep() });
});

export default router;

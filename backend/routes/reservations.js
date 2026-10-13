import express from 'express';
import db from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { makeId, generateReservationCode, generatePickupPin, generateQrToken, sanitizeText, toNumber } from '../utils/helpers.js';

const router = express.Router();

router.post('/', authenticate, (req, res) => {
  const body = req.body || {};
  const userId = req.user.id;
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(body.deal_id);

  if (!deal) {
    return res.status(404).json({ success: false, message: 'Deal not found.' });
  }

  if (deal.status !== 'active' || new Date(deal.expires_at).getTime() <= Date.now()) {
    db.prepare('UPDATE deals SET status = ? WHERE id = ?').run('expired', deal.id);
    return res.status(400).json({ success: false, message: 'Deal has expired.' });
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
    db.prepare(`UPDATE deals SET quantity_remaining = quantity_remaining - ? WHERE id = ? AND quantity_remaining >= ?`).run(quantity, deal.id, quantity);
    const updatedDeal = db.prepare('SELECT * FROM deals WHERE id = ?').get(deal.id);
    if (!updatedDeal || updatedDeal.quantity_remaining < 0) {
      throw new Error('Stock update failed.');
    }

    if (updatedDeal.quantity_remaining === 0) {
      db.prepare('UPDATE deals SET status = ? WHERE id = ?').run('sold_out', deal.id);
    }

    db.prepare(`INSERT INTO reservations (id, user_id, deal_id, shop_id, quantity, total_amount, reservation_code, pickup_pin, qr_token, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(reservationId, userId, deal.id, deal.shop_id, quantity, totalAmount, reservationCode, pickupPin, qrToken, 'reserved', new Date().toISOString(), expiresAt);

    db.prepare(`INSERT INTO payments (id, reservation_id, user_id, status, gateway, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(makeId('payment'), reservationId, userId, 'success', 'development', totalAmount, new Date().toISOString());
  });

  try {
    tx();
  } catch (error) {
    return res.status(409).json({ success: false, message: 'Unable to reserve this deal. Please try again.' });
  }

  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
  return res.status(201).json({
    success: true,
    message: 'Reservation confirmed.',
    reservation: {
      id: reservation.id,
      reservation_code: reservation.reservation_code,
      pickup_pin: reservation.pickup_pin,
      qr_token: reservation.qr_token,
      quantity: reservation.quantity,
      total_amount: reservation.total_amount,
      shop_id: reservation.shop_id,
      deal_id: reservation.deal_id,
      status: reservation.status,
      expires_at: reservation.expires_at
    }
  });
});

router.get('/', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM reservations WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  return res.json({ success: true, reservations: rows });
});

router.get('/:id', authenticate, (req, res) => {
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!reservation) {
    return res.status(404).json({ success: false, message: 'Reservation not found.' });
  }
  if (req.user.role !== 'admin' && reservation.user_id !== req.user.id) {
    return res.status(403).json({ success: false, message: 'You do not have access to this reservation.' });
  }
  return res.json({ success: true, reservation });
});

router.post('/:id/verify', authenticate, requireRole('shop_owner', 'admin'), (req, res) => {
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!reservation) {
    return res.status(404).json({ success: false, message: 'Reservation not found.' });
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

  db.prepare('UPDATE reservations SET status = ? WHERE id = ?').run('collected', req.params.id);
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
    const updated = db.prepare('UPDATE reservations SET status = ? WHERE id = ? AND status = ?')
      .run('cancelled', req.params.id, 'reserved');
    if (updated.changes === 1) {
      const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(reservation.deal_id);
      let dealStatus = deal.status;
      if (deal.status === 'sold_out') {
        dealStatus = new Date(deal.expires_at).getTime() > Date.now() ? 'active' : 'expired';
      }
      db.prepare('UPDATE deals SET quantity_remaining = quantity_remaining + ?, status = ? WHERE id = ?')
        .run(reservation.quantity, dealStatus, reservation.deal_id);
    }
  });
  tx();
  return res.json({ success: true, message: 'Reservation cancelled.' });
});

export default router;

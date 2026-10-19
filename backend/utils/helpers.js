import crypto from 'crypto';
import db from '../config/db.js';

export function makeId(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function generateReservationCode() {
  return `BFL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

export function generatePickupPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function generateQrToken() {
  return `BFL-RESERVATION-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

export function toNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

export function sanitizeText(value) {
  return (value ?? '').toString().trim();
}

export function calculateDiscount(originalPrice, salePrice) {
  const original = toNumber(originalPrice, 0);
  const sale = toNumber(salePrice, 0);

  if (original <= 0) return 0;
  const ratio = ((original - sale) / original) * 100;
  return Math.max(0, Math.min(100, Math.round(ratio)));
}

export function nowIso() {
  return new Date().toISOString();
}

/** Appends an audit row to activity_logs (best effort; never throws). */
export function logActivity({ actorId = null, actorRole = null, action, targetType = null, targetId = null, metadata = null }) {
  try {
    db.prepare(
      'INSERT INTO activity_logs (id, actor_id, actor_role, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(makeId('log'), actorId, actorRole, action, targetType, targetId, metadata ? JSON.stringify(metadata) : null, nowIso());
  } catch { /* logging must never break a request */ }
}

/**
 * Creates in-app notifications for a set of recipient ids. Audience values:
 * 'all' | 'customers' | 'shop_owners' resolved against users.role.
 */
export function notifyUsers(recipientIds, { type, title, message }) {
  try {
    const stmt = db.prepare(
      'INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
    );
    const ts = nowIso();
    const tx = db.transaction((ids) => {
      for (const uid of ids) stmt.run(makeId('notif'), uid, type, title, message, ts);
    });
    tx([...new Set(recipientIds)].filter(Boolean));
  } catch { /* notifications must never break a request */ }
}

/** Notification recipient ids matching an announcements audience. */
export function audienceUserIds(audience) {
  const rows =
    audience === 'customers'
      ? db.prepare(`SELECT id FROM users WHERE role = 'customer' AND status = 'active'`).all()
      : audience === 'shop_owners'
        ? db.prepare(`SELECT id FROM users WHERE role = 'shop_owner' AND status = 'active'`).all()
        : db.prepare(`SELECT id FROM users WHERE status = 'active'`).all();
  return rows.map((r) => r.id);
}

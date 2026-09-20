import crypto from 'crypto';

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

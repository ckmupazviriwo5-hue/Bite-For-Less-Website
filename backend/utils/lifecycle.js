import db from '../config/db.js';

let lastSweep = 0;

// Lazy, safe reservation expiry sweeper. better-sqlite3 is single-connection and
// synchronous, and the status flip is guarded by `WHERE status = 'reserved'`, so
// under WAL each stale reservation is expired and its stock restored EXACTLY
// once, even when the sweeper runs concurrently with other requests.
export function sweepExpiredReservations({ cooldownMs = 4000 } = {}) {
  const nowMs = Date.now();
  if (nowMs - lastSweep < cooldownMs) return;
  lastSweep = nowMs;

  db.transaction(() => {
    // 1. Expire stale reservations + restore stock exactly once.
    const stale = db.prepare("SELECT id, deal_id, quantity FROM reservations WHERE status = 'reserved' AND expires_at <= ?")
      .all(new Date(nowMs).toISOString());
    for (const r of stale) {
      const flipped = db.prepare("UPDATE reservations SET status = 'expired' WHERE id = ? AND status = 'reserved'").run(r.id);
      if (flipped.changes !== 1) continue;
      const deal = db.prepare('SELECT status, expires_at FROM deals WHERE id = ?').get(r.deal_id);
      if (!deal) continue;
      let dealStatus = deal.status;
      if (deal.status === 'sold_out') {
        dealStatus = new Date(deal.expires_at).getTime() > nowMs ? 'active' : 'expired';
      }
      db.prepare('UPDATE deals SET quantity_remaining = quantity_remaining + ?, status = ? WHERE id = ?')
        .run(r.quantity, dealStatus, r.deal_id);
    }
    // 2. Flip expired active listings so no stale row is ever bookable or shown.
    db.prepare("UPDATE deals SET status = 'expired' WHERE status = 'active' AND expires_at <= ?").run(new Date(nowMs).toISOString());
  })();
}

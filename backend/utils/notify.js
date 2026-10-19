import db from '../config/db.js';
import { makeId } from './helpers.js';

// Notifications must never break the main flow — failures are swallowed.
export function notifyUser(userId, type, title, message) {
  try {
    db.prepare('INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
      .run(makeId('note'), userId, type, title, message, new Date().toISOString());
  } catch { /* non-fatal */ }
}

// Audit trail for admin/vendor-affecting actions. Never breaks the flow.
export function logActivity({ actorId = null, actorRole = null, action, targetType = null, targetId = null, metadata = null }) {
  try {
    db.prepare('INSERT INTO activity_logs (id, actor_id, actor_role, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(makeId('log'), actorId, actorRole, action, targetType, targetId, metadata ? JSON.stringify(metadata) : null, new Date().toISOString());
  } catch { /* non-fatal */ }
}

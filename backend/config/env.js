import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// JWT secret: never ship the known development fallback for shared-network
// use. When JWT_SECRET is not set in the environment, a strong random secret
// is generated once and persisted to backend/data/.jwt-secret (gitignored).
// Deleting that file simply rotates the secret (all sessions become invalid).
// ---------------------------------------------------------------------------
function resolveJwtSecret() {
  const fromEnv = (process.env.JWT_SECRET || '').trim();
  if (fromEnv && fromEnv !== 'bite-for-less-dev-secret') return fromEnv;

  const secretFile = path.join(backendRoot, 'data', '.jwt-secret');
  try {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing && existing !== 'bite-for-less-dev-secret') return existing;
  } catch { /* first run */ }

  const generated = crypto.randomBytes(48).toString('hex');
  try {
    fs.mkdirSync(path.dirname(secretFile), { recursive: true });
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  } catch { /* read-only fs: fall back to in-memory secret */ }
  return generated;
}

export const config = {
  port: Number(process.env.PORT || 5000),
  host: process.env.HOST || '0.0.0.0', // LAN-reachable; document firewall in docs/LOCAL_DEMO_SETUP.md
  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'sqlite:./backend/data/biteforless.db',
  adminEmail: (process.env.ADMIN_EMAIL || 'admin@biteforless.test').trim().toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  // Comma-separated CORS origins for the Android app / other pages. 'true'
  // (default) keeps local demo permissive; set explicitly for tighter control.
  corsOrigin: process.env.CORS_ORIGIN || 'true',
  uploadsDir: process.env.UPLOADS_DIR || path.join(backendRoot, 'uploads'),
  seedDemoData: (process.env.SEED_DEMO_DATA || 'true') !== 'false'
};

if (config.nodeEnv === 'production' && !process.env.JWT_SECRET) {
  console.warn('[bfl] JWT_SECRET not set in env — using generated secret from backend/data/.jwt-secret.');
}

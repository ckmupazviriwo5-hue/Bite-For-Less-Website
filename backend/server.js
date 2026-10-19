import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from './config/env.js';
import db from './config/db.js';
import authRoutes from './routes/auth.js';
import dealRoutes from './routes/deals.js';
import reservationRoutes, { runExpirySweep } from './routes/reservations.js';
import reviewRoutes from './routes/reviews.js';
import shopRoutes from './routes/shops.js';
import vendorRoutes from './routes/vendors.js';
import adminRoutes from './routes/admin.js';
import notificationRoutes from './routes/notifications.js';
import categoryRoutes from './routes/categories.js';
import favoriteRoutes from './routes/favorites.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      // QRCode.js CDN (used with a graceful offline fallback).
      'script-src': ["'self'", 'https://cdnjs.cloudflare.com'],
      // Local uploads + any remaining licensed remote demo photography.
      'img-src': ["'self'", 'data:', 'https://images.unsplash.com']
    }
  }
}));

// CORS: same-origin website works trivially; the Android app on the LAN uses
// no cookies (Bearer tokens), so permissive echo is safe locally. CORS_ORIGIN
// narrows it (comma-separated list) when tighter control is wanted.
const corsOriginEnv = config.corsOrigin.trim();
app.use(cors({
  origin: corsOriginEnv === 'true' ? true : corsOriginEnv.split(',').map((s) => s.trim()).filter(Boolean),
  credentials: false
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  message: { success: false, message: 'Too many requests. Please try again later.' }
}));
// Stricter limiter for credential endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  message: { success: false, message: 'Too many login attempts. Please wait a few minutes.' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/admin/login', authLimiter);

if (!fs.existsSync(config.uploadsDir)) fs.mkdirSync(config.uploadsDir, { recursive: true });

app.use((req, res, next) => {
  res.setHeader('X-Powered-By', 'Bite For Less');
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    message: 'Bite For Less API is running.',
    database: 'sqlite',
    mode: 'local',
    time: new Date().toISOString()
  });
});

// Uploaded artifacts are served read-only through the API origin. Website and
// Android both resolve them as `<api-origin>/uploads/...`.
app.use('/uploads', express.static(config.uploadsDir, { immutable: true, maxAge: '7d' }));

app.use('/api/auth', authRoutes);
app.use('/api/deals', dealRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/favorites', favoriteRoutes);

// Unknown API paths must return JSON (not the SPA shell), so Android/website
// clients can distinguish "route doesn't exist" from "server down".
app.all('/api/*', (_req, res) => {
  res.status(404).json({ success: false, message: 'API endpoint not found.' });
});

const frontendDir = path.join(__dirname, '../frontend');
app.use(express.static(frontendDir));

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err && err.status ? err.status : 500;
  const isUpload = err && (err.name === 'MulterError' || err.code === 'LIMIT_FILE_SIZE');
  console.error(err && err.stack ? err.stack : err);
  if (isUpload) {
    const msgs = {
      LIMIT_FILE_SIZE: 'Image too large — 5 MB maximum.',
      LIMIT_UNEXPECTED_FILE: 'Unsupported image type. Use JPEG, PNG, WebP or GIF.'
    };
    return res.status(400).json({ success: false, message: msgs[err.code] || 'Upload rejected.' });
  }
  res.status(status === 500 ? 500 : 400).json({ success: false, message: 'Something went wrong. Please try again.' });
});

// Expiry maintenance: lazy sweep on boot + interval while running. Exactly-once
// stock restore is guaranteed by the status guard inside the sweep.
try {
  const sweep = runExpirySweep();
  if (sweep.reservationsExpired > 0) console.log(`[bfl] expiry sweep on boot: ${sweep.reservationsExpired} reservation(s) expired.`);
} catch (err) {
  console.error('[bfl] boot sweep failed:', err);
}
const sweepTimer = setInterval(() => {
  try {
    const sweep = runExpirySweep();
    if (sweep.reservationsExpired > 0) console.log(`[bfl] expiry sweep: ${sweep.reservationsExpired} reservation(s) expired.`);
  } catch (err) {
    console.error('[bfl] sweep failed:', err);
  }
}, 30 * 1000);
sweepTimer.unref?.();

const server = app.listen(config.port, config.host, () => {
  const shown = config.host === '0.0.0.0' ? 'localhost + all LAN interfaces' : config.host;
  console.log(`Bite For Less API listening on port ${config.port} (${shown}).`);
  console.log(`Bite For Less API listening on http://localhost:${config.port}`);
});

process.on('SIGINT', () => {
  sweepTimer?.unref?.();
  server.close(() => {
    db.close();
    process.exit(0);
  });
});

export default app;

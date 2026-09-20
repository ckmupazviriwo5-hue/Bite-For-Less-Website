import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/env.js';
import db from './config/db.js';
import authRoutes from './routes/auth.js';
import dealRoutes from './routes/deals.js';
import reservationRoutes from './routes/reservations.js';
import reviewRoutes from './routes/reviews.js';
import shopRoutes from './routes/shops.js';
import adminRoutes from './routes/admin.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(helmet({
  crossOriginResourcePolicy: false
}));

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { success: false, message: 'Too many requests. Please try again later.' }
}));

app.use((req, res, next) => {
  res.setHeader('X-Powered-By', 'Bite For Less');
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Bite For Less API is running.' });
});

app.use('/api/auth', authRoutes);
app.use('/api/deals', dealRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/admin', adminRoutes);

const frontendDir = path.join(__dirname, '../frontend');
app.use(express.static(frontendDir));

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
});

const server = app.listen(config.port, () => {
  console.log(`Bite For Less API listening on port ${config.port}`);
});

process.on('SIGINT', () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
});

export default app;

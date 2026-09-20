import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 5000),
  jwtSecret: process.env.JWT_SECRET || 'bite-for-less-dev-secret',
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'sqlite:./backend/data/biteforless.db',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@biteforless.test',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123'
};

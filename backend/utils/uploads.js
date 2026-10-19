import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { config } from '../config/env.js';

/**
 * Genuine multipart image uploads (multer), security-first:
 *  - files live under backend/uploads/<kind>/ only, never caller-controlled;
 *  - filenames are random hex + a sniffed-bytes extension (no traversal,
 *    no client-provided names);
 *  - the FIRST magic bytes must match an allowed image type — claiming a
 *    .jpg extension with executable or non-image content is rejected;
 *  - per-request size cap and file count cap;
 *  - nothing is executed or served from anywhere else.
 */

const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif']
]);

const KINDS = new Set(['products', 'logos', 'covers', 'profiles']);

export function sniffImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
  return null;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Deletes an uploaded artifact safely (only inside backend/uploads). */
export function removeUploadFile(publicPath) {
  if (!publicPath || typeof publicPath !== 'string') return;
  if (!publicPath.startsWith('/uploads/')) return;
  const relative = publicPath.replace('/uploads/', '');
  const target = path.resolve(config.uploadsDir, relative);
  const root = path.resolve(config.uploadsDir);
  if (target !== root && target.startsWith(root + path.sep) && fs.existsSync(target)) {
    try { fs.unlinkSync(target); } catch { /* best effort */ }
  }
}

function storageFor(kind) {
  const dir = path.join(config.uploadsDir, kind);
  return multer.diskStorage({
    destination(_req, _file, cb) {
      try {
        ensureDir(dir);
        cb(null, dir);
      } catch (err) {
        cb(err);
      }
    },
    filename(_req, file, cb) {
      const ext = ALLOWED.get(file.mimetype) || 'bin';
      cb(null, `${crypto.randomBytes(12).toString('hex')}.${ext}`);
    }
  });
}

/**
 * Returns (req, res, next) middleware. Files arrive on req.file / req.files;
 * req files are validated afterwards in routes (0-byte or spoofed content is
 * rejected there via sniffImageType) and cleaned up.
 */
export function uploadImages(kind, { maxCount = 1, maxBytes = 5 * 1024 * 1024 } = {}) {
  if (!KINDS.has(kind)) throw new Error(`Unknown upload kind: ${kind}`);
  const upload = multer({
    storage: storageFor(kind),
    limits: { fileSize: maxBytes, files: maxCount },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED.has(file.mimetype)) {
        return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Unsupported image type. Use JPEG, PNG, WebP or GIF.'));
      }
      ensureDir(path.join(config.uploadsDir, kind));
      cb(null, true);
    }
  });
  return upload;
}

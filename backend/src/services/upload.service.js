'use strict';

/**
 * Image uploads to the on-premise filesystem.
 *
 * WHAT IS STORED WHERE
 *
 * The file goes to `<FILE_STORAGE_PATH>/<entity>/<name>` on disk. The database
 * gets `/uploads/<entity>/<name>` — an application path, never an absolute
 * filesystem path, so the storage root can move between servers or
 * deployments without rewriting a single row.
 *
 * That application path lives in the SAME column as an external image URL.
 * `banners.image_url` and friends are VARCHAR(500) with no format constraint,
 * so `https://example.com/a.jpg` and `/uploads/banners/ab12.webp` are both
 * valid values and every consumer reads one field. No migration, no second
 * column, no discriminator.
 *
 * WHY THE FILE IS VALIDATED IN MEMORY
 *
 * multer is configured with memory storage, so nothing reaches the disk until
 * this module has looked at the bytes. Writing first and validating afterwards
 * would leave a window in which an unvalidated file exists under a served
 * directory.
 *
 * A file is accepted only if its leading bytes match a known image signature.
 * The extension and the browser-supplied MIME type are both attacker
 * controlled and neither is trusted: the stored extension is derived from the
 * detected signature, not from what was uploaded.
 */

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const env = require('../config/env');
const logger = require('../config/logger');
const { ValidationError } = require('../utils/errors');

/**
 * Entities that may own an uploaded image, mapped to the permission module
 * that guards them.
 *
 * This is an allowlist and the only source of directory names. A caller
 * cannot introduce a new folder, and `..` or an absolute path can never reach
 * `path.join` because nothing outside these keys is accepted.
 */
const UPLOAD_ENTITIES = Object.freeze({
  banners: 'Banners',
  films: 'Settings',
  categories: 'Categories',
  chains: 'Settings',
  products: 'Products',
});

const ENTITY_NAMES = Object.freeze(Object.keys(UPLOAD_ENTITIES));

/** The public prefix under which uploads are served. */
const PUBLIC_PREFIX = '/uploads';

/**
 * Accepted image signatures, checked against the first bytes of the file.
 *
 * Kept to formats a browser renders natively. SVG is deliberately excluded:
 * it is XML, it can carry script, and serving it from the application origin
 * would be a stored cross-site scripting vector.
 */
const SIGNATURES = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: 'png',
    mime: 'image/png',
    test: (b) =>
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a,
  },
  {
    ext: 'gif',
    mime: 'image/gif',
    test: (b) =>
      b.subarray(0, 6).toString('latin1') === 'GIF87a' ||
      b.subarray(0, 6).toString('latin1') === 'GIF89a',
  },
  {
    ext: 'webp',
    mime: 'image/webp',
    // RIFF....WEBP - the size field sits between the two markers.
    test: (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

/**
 * Identify the format from the bytes themselves.
 *
 * @returns {{ext: string, mime: string}}
 * @throws {ValidationError} When nothing matches - which is what a renamed
 *   executable, a PDF or a text file looks like here.
 */
function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    throw new ValidationError('That file is not a readable image', [
      { field: 'file', message: 'The file is empty or too small to be an image' },
    ]);
  }

  const match = SIGNATURES.find((signature) => signature.test(buffer));

  if (!match) {
    throw new ValidationError('That file is not a supported image', [
      {
        field: 'file',
        message:
          'Upload a JPEG, PNG, GIF or WebP image. The file contents did not match any of these.',
      },
    ]);
  }

  return { ext: match.ext, mime: match.mime };
}

/** @throws {ValidationError} For anything outside the allowlist. */
function assertEntity(entity) {
  if (!Object.prototype.hasOwnProperty.call(UPLOAD_ENTITIES, entity)) {
    throw new ValidationError('Unknown upload type', [
      { field: 'entity', message: `Must be one of: ${ENTITY_NAMES.join(', ')}` },
    ]);
  }
}

/** Absolute directory for one entity, derived only from the allowlist. */
function entityDir(entity) {
  assertEntity(entity);
  return path.join(env.uploads.storagePath, entity);
}

/**
 * Store an uploaded image and return the value to save on the record.
 *
 * The filename is 16 random bytes plus the detected extension. It carries
 * nothing from the upload: no original name, no user input, no sequence. That
 * removes filename collisions, path traversal and the "innocuous name, nasty
 * content" class of problem in one step, and it means an uploaded file can
 * never overwrite an existing one.
 *
 * @param {string} entity One of UPLOAD_ENTITIES.
 * @param {Buffer} buffer The file, still in memory.
 * @returns {Promise<{path: string, mime: string, bytes: number}>} `path` is the
 *   application path to store, e.g. `/uploads/products/9f2c….webp`.
 */
async function storeImage(entity, buffer) {
  assertEntity(entity);

  const { ext, mime } = detectImageType(buffer);

  const dir = entityDir(entity);
  await fs.mkdir(dir, { recursive: true });

  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;

  // `wx` fails rather than truncating if the name somehow already exists.
  await fs.writeFile(path.join(dir, name), buffer, { flag: 'wx' });

  logger.info('Image uploaded', { entity, name, bytes: buffer.length, mime });

  return { path: `${PUBLIC_PREFIX}/${entity}/${name}`, mime, bytes: buffer.length };
}

/**
 * True when a stored image value points at our own upload directory.
 *
 * Used to tell a local file apart from an external URL before anything is
 * deleted. Anything that is not exactly `/uploads/<known-entity>/<name>` is
 * treated as external and left alone - including an absolute URL that merely
 * contains the substring `/uploads/`.
 */
function isLocalUpload(value) {
  return parseLocalUpload(value) !== null;
}

/**
 * Break a stored value into its entity and filename, or null if it is not a
 * local upload.
 *
 * The filename pattern is deliberately strict - hex plus one known extension -
 * so a crafted value such as `/uploads/products/../../../etc/passwd` does not
 * parse and can never reach the filesystem.
 */
function parseLocalUpload(value) {
  if (typeof value !== 'string') return null;

  const match = value.match(/^\/uploads\/([a-z]+)\/([a-f0-9]{32}\.(?:jpg|png|gif|webp))$/);
  if (!match) return null;

  const [, entity, name] = match;
  if (!Object.prototype.hasOwnProperty.call(UPLOAD_ENTITIES, entity)) return null;

  return { entity, name };
}

/**
 * Delete a previously uploaded file.
 *
 * Callers must have established that the value is no longer referenced. This
 * function refuses anything that is not a well-formed local upload path, so an
 * external URL passed here is a no-op rather than an attempt to delete
 * something.
 *
 * A missing file is not an error: the record and the disk are allowed to
 * disagree, and failing a user's save because a file was already gone would be
 * worse than the inconsistency.
 *
 * @returns {Promise<boolean>} Whether a file was actually removed.
 */
async function deleteLocalUpload(value) {
  const parsed = parseLocalUpload(value);
  if (!parsed) return false;

  try {
    await fs.unlink(path.join(entityDir(parsed.entity), parsed.name));
    logger.info('Image deleted', { entity: parsed.entity, name: parsed.name });
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;

    // Never fail the surrounding request over cleanup. An orphan on disk is
    // recoverable; a failed save is visible to the user.
    logger.warn('Could not delete uploaded image', {
      entity: parsed.entity,
      name: parsed.name,
      error: error.message,
    });
    return false;
  }
}

module.exports = {
  UPLOAD_ENTITIES,
  ENTITY_NAMES,
  PUBLIC_PREFIX,
  detectImageType,
  storeImage,
  isLocalUpload,
  parseLocalUpload,
  deleteLocalUpload,
  entityDir,
};

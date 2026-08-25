'use strict';

/**
 * Encrypts and decrypts values stored in `payment_gateway_config.gateway_secret_encrypted`.
 *
 * This is the ONLY place a per-cinema payment gateway secret is ever
 * encrypted or decrypted. Everything above this module works with the
 * plaintext secret only in memory, for the duration of one gateway call, and
 * never writes it back to disk or logs it.
 *
 * AES-256-GCM: authenticated encryption, so a tampered ciphertext (someone
 * editing the column directly, or corruption) fails to decrypt loudly rather
 * than silently returning garbage that would then be sent to Cashfree as a
 * secret key.
 *
 * The key itself lives OUTSIDE the database entirely -
 * `CREDENTIALS_ENCRYPTION_KEY`, validated at boot by config/env.js. A
 * database backup or leak on its own is therefore not enough to recover a
 * working Cashfree credential; the encryption key would also have to leak
 * separately, from server configuration rather than the database.
 */

const crypto = require('crypto');

const env = require('../config/env');

const ALGORITHM = 'aes-256-gcm';
/** Recommended IV length for GCM. Not a secret - stored alongside the ciphertext. */
const IV_LENGTH = 12;
/** GCM's authentication tag is always 16 bytes. */
const AUTH_TAG_LENGTH = 16;

/**
 * Resolves the 32-byte AES-256 key from the configured hex string.
 *
 * Deferred to call time rather than resolved once at module load, so that
 * importing this module never requires the key to be configured - only an
 * environment that actually stores or reads an encrypted credential does.
 *
 * @throws {Error} If the key is missing or not exactly 32 bytes once decoded.
 */
function getKey() {
  const raw = env.security.credentialsEncryptionKey;

  if (!raw) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY is not configured - cannot encrypt or decrypt a payment gateway credential'
    );
  }

  const key = Buffer.from(raw, 'hex');

  if (key.length !== 32) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex characters) for AES-256'
    );
  }

  return key;
}

/**
 * Encrypts a plaintext credential for storage.
 *
 * The output is a single base64 string carrying `iv || authTag || ciphertext`
 * concatenated - self-contained, so the column holds everything decrypt()
 * needs and nothing else has to be stored alongside it.
 *
 * @param {string} plaintext
 * @returns {string} Base64-encoded `iv || authTag || ciphertext`.
 */
function encrypt(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('Cannot encrypt an empty credential');
  }

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/**
 * Decrypts a value produced by `encrypt()`.
 *
 * Throws rather than returning a corrupted or tampered value - a payment
 * gateway call made with a mangled secret is a call the merchant's Cashfree
 * account would reject anyway, so failing before the network call is strictly
 * better: it never leaves this process, and the error is unambiguous.
 *
 * @param {string} encoded
 * @returns {string} The original plaintext.
 */
function decrypt(encoded) {
  if (typeof encoded !== 'string' || encoded.length === 0) {
    throw new Error('Cannot decrypt an empty value');
  }

  const key = getKey();
  const buffer = Buffer.from(encoded, 'base64');

  if (buffer.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Encrypted credential is malformed - too short to contain an IV and auth tag');
  }

  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = { encrypt, decrypt };

// Secure password hashing using Node's built-in crypto module (scrypt).
// This intentionally avoids installing bcrypt/bcryptjs, per the project's
// strict no-extra-dependency policy. scrypt is a well-vetted, memory-hard
// KDF included in Node core and is a reasonable substitute for bcrypt.

const crypto = require('crypto');

const KEY_LENGTH = 64;

function hashPassword(plainPassword) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plainPassword, salt, KEY_LENGTH).toString('hex');
  return { hash, salt };
}

function verifyPassword(plainPassword, storedHash, storedSalt) {
  const candidateHash = crypto.scryptSync(plainPassword, storedSalt, KEY_LENGTH);
  const storedBuffer = Buffer.from(storedHash, 'hex');
  if (storedBuffer.length !== candidateHash.length) return false;
  // Constant-time comparison to avoid timing attacks.
  return crypto.timingSafeEqual(storedBuffer, candidateHash);
}

module.exports = { hashPassword, verifyPassword };

/* ==========================================================================
   Wells Safety API — accounts, passwords, sessions.

   Passwords go through scrypt with a per-user salt and are compared in
   constant time. Sessions are opaque random tokens in an httpOnly, SameSite
   cookie — nothing about the user is encoded in them, so a stolen cookie
   cannot be edited into a different role.
   ========================================================================== */

import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from "node:crypto";
import { db, now } from "./db.js";

const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/* ------------------------------------------------------------- passwords -- */

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, SCRYPT.keylen, SCRYPT).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const attempt = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  const stored = Buffer.from(hash, "hex");
  return stored.length === attempt.length && timingSafeEqual(stored, attempt);
}

/* ----------------------------------------------------------------- users -- */

export function createAccount({ name, plan = "starter" }) {
  const id = randomUUID();
  db.prepare("INSERT INTO accounts (id, name, plan, created_at) VALUES (?,?,?,?)")
    .run(id, name, plan, now());
  return id;
}

export function createUser({ accountId, email, name, password, role = "driver" }) {
  const { hash, salt } = hashPassword(password);
  const id = randomUUID();
  db.prepare(`INSERT INTO users (id, account_id, email, name, role, pw_hash, pw_salt, created_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, accountId, String(email).toLowerCase().trim(), name, role, hash, salt, now());
  return id;
}

export function userByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ?")
    .get(String(email).toLowerCase().trim());
}

export function setPassword(userId, password) {
  const { hash, salt } = hashPassword(password);
  db.prepare("UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?").run(hash, salt, userId);
  // Changing a password ends every other session for that user.
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

/* -------------------------------------------------------------- sessions -- */

export function startSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)")
    .run(token, userId, now(), expires);
  return { token, expires };
}

export function endSession(token) {
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function userForToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.*, a.plan, a.name AS account_name
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    JOIN accounts a ON a.id = u.account_id
    WHERE s.token = ? AND s.expires_at > ? AND u.active = 1
  `).get(token, now());
  if (row) {
    db.prepare("UPDATE users SET last_seen = ? WHERE id = ?").run(now(), row.id);
  }
  return row || null;
}

/* ------------------------------------------------------- login throttling -- */

// Small in-memory backoff. Enough to make guessing a password over the network
// pointless; it resets on restart, which is fine for a single-tenant server.
const attempts = new Map();
const WINDOW_MS = 15 * 60_000;
const MAX_TRIES = 8;

export function throttled(key) {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) { attempts.delete(key); return false; }
  return rec.count >= MAX_TRIES;
}

export function noteFailure(key) {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > WINDOW_MS) {
    attempts.set(key, { first: Date.now(), count: 1 });
  } else {
    rec.count++;
  }
}

export function clearFailures(key) {
  attempts.delete(key);
}

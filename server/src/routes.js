/* ==========================================================================
   Wells Safety API — routes.
   ========================================================================== */

import { randomUUID, randomBytes } from "node:crypto";
import { writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { db, now } from "./db.js";
import {
  createUser, userByEmail, userForToken, verifyPassword, setPassword,
  startSession, endSession, throttled, noteFailure, clearFailures
} from "./auth.js";
import { PLANS, planOf, allows, lockedPayload, FEATURE_COPY } from "./plans.js";
import { json, text, readJson, cookies, setCookie, escapeHtml } from "./http.js";

const COOKIE = "ws_session";
const PHOTO_DIR = process.env.PHOTO_DIR || "/data/photos";

/* ------------------------------------------------------------- guards --- */

function requireUser(req, res) {
  const user = userForToken(cookies(req)[COOKIE]);
  if (!user) { json(res, 401, { error: "not_signed_in" }); return null; }
  return user;
}

function requireFeature(user, feature, res) {
  if (allows(user.plan, feature)) return true;
  json(res, 402, lockedPayload(feature));
  return false;
}

function requireRole(user, roles, res) {
  if (roles.includes(user.role)) return true;
  json(res, 403, { error: "not_allowed", need: roles });
  return false;
}

/* --------------------------------------------------------------- auth --- */

async function login(req, res) {
  const { email, password } = await readJson(req);
  const key = String(email || "").toLowerCase() + "|" + (req.socket.remoteAddress || "");

  if (throttled(key)) {
    return json(res, 429, { error: "too_many_attempts", retryMinutes: 15 });
  }

  const user = email ? userByEmail(email) : null;
  // Same answer either way, so this cannot be used to enumerate addresses.
  if (!user || !user.active || !verifyPassword(String(password || ""), user.pw_hash, user.pw_salt)) {
    noteFailure(key);
    return json(res, 401, { error: "bad_credentials" });
  }

  clearFailures(key);
  const { token } = startSession(user.id);
  setCookie(res, COOKIE, token, { maxAge: 30 * 86400 });
  // Re-read through the session so the response carries the account's plan.
  // The users row alone has no plan column, and answering from it would tell
  // the client "starter" until the next reload — hiding features already paid for.
  json(res, 200, { user: publicUser(userForToken(token)) });
}

function publicUser(u) {
  const plan = planOf(u.plan);
  return {
    id: u.id, name: u.name, email: u.email, role: u.role,
    account: u.account_name,
    plan: { id: plan.id, name: plan.name, price: plan.price, features: plan.features, limits: plan.limits },
    catalogue: PLANS,
    featureCopy: FEATURE_COPY
  };
}

/* --------------------------------------------------------------- book --- */

function getBook(user, res) {
  if (!requireFeature(user, "sync", res)) return;
  const row = db.prepare("SELECT version, doc, updated_at, updated_by FROM books WHERE account_id = ?")
    .get(user.account_id);
  json(res, 200, row
    ? { version: row.version, doc: JSON.parse(row.doc), updatedAt: row.updated_at, updatedBy: row.updated_by }
    : { version: 0, doc: null, updatedAt: null, updatedBy: null });
}

async function putBook(req, user, res) {
  if (!requireFeature(user, "sync", res)) return;
  if (!requireRole(user, ["owner", "dispatch"], res)) return;

  const { doc, baseVersion } = await readJson(req);
  if (!doc || typeof doc !== "object") return json(res, 400, { error: "doc_required" });

  const row = db.prepare("SELECT version FROM books WHERE account_id = ?").get(user.account_id);
  const current = row ? row.version : 0;

  // Refuse to clobber a newer write from another device; the client re-pulls,
  // merges, and tries again rather than silently losing somebody's edits.
  if (baseVersion != null && Number(baseVersion) !== current) {
    return json(res, 409, { error: "version_conflict", currentVersion: current });
  }

  const next = current + 1;
  db.prepare(`INSERT INTO books (account_id, version, doc, updated_at, updated_by)
              VALUES (?,?,?,?,?)
              ON CONFLICT(account_id) DO UPDATE SET
                version=excluded.version, doc=excluded.doc,
                updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
    .run(user.account_id, next, JSON.stringify(doc), now(), user.name);

  json(res, 200, { version: next, updatedAt: now(), updatedBy: user.name });
}

/* ------------------------------------------------------------ reports --- */

async function postReport(req, user, res) {
  if (!requireFeature(user, "reports", res)) return;

  const body = await readJson(req);
  const report = body.report || body;
  if (report.kind !== "wellssafety.jobreport") {
    return json(res, 400, { error: "not_a_job_report" });
  }

  const id = String(report.id || randomUUID()).slice(0, 64);
  if (db.prepare("SELECT 1 FROM reports WHERE id = ?").get(id)) {
    return json(res, 200, { id, duplicate: true });
  }

  const photos = Array.isArray(body.photos) ? body.photos.slice(0, 24) : [];
  const limitBytes = planOf(user.plan).limits.photoMb * 1024 * 1024;
  const used = db.prepare("SELECT COALESCE(SUM(bytes),0) AS b FROM photos p JOIN reports r ON r.id = p.report_id WHERE r.account_id = ?")
    .get(user.account_id).b;

  db.prepare(`INSERT INTO reports (id, account_id, user_id, filed_at, driver, customer, load_ref, doc)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, user.account_id, user.id, report.filed || now(),
         report.driver || user.name, report.customer || "", report.loadRef || "",
         JSON.stringify(report));

  await mkdir(join(PHOTO_DIR, id), { recursive: true });

  let stored = 0, skipped = 0, total = used;
  for (let i = 0; i < photos.length; i++) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(photos[i] || ""));
    if (!m) { skipped++; continue; }
    const buf = Buffer.from(m[2], "base64");
    if (total + buf.length > limitBytes) { skipped++; continue; }
    const path = join(PHOTO_DIR, id, `${i}.jpg`);
    await writeFile(path, buf);
    db.prepare("INSERT INTO photos (id, report_id, idx, mime, bytes, path) VALUES (?,?,?,?,?,?)")
      .run(randomUUID(), id, i, m[1], buf.length, path);
    stored++; total += buf.length;
  }

  json(res, 201, { id, photosStored: stored, photosSkipped: skipped, storageUsedMb: Math.round(total / 1048576) });
}

function listReports(user, res) {
  if (!requireFeature(user, "reports", res)) return;
  const rows = db.prepare(`
    SELECT r.id, r.filed_at, r.driver, r.customer, r.load_ref, r.doc, r.invoice_id,
           (SELECT COUNT(*) FROM photos p WHERE p.report_id = r.id) AS photo_count
    FROM reports r WHERE r.account_id = ? ORDER BY r.filed_at DESC LIMIT 500
  `).all(user.account_id);
  json(res, 200, {
    reports: rows.map((r) => ({
      ...JSON.parse(r.doc),
      id: r.id,
      invoiceId: r.invoice_id || null,
      photoCount: r.photo_count
    }))
  });
}

async function getPhoto(user, reportId, idx, res) {
  if (!requireFeature(user, "reports", res)) return;
  const row = db.prepare(`
    SELECT p.path, p.mime FROM photos p JOIN reports r ON r.id = p.report_id
    WHERE p.report_id = ? AND p.idx = ? AND r.account_id = ?
  `).get(reportId, Number(idx), user.account_id);
  if (!row) return json(res, 404, { error: "no_such_photo" });
  try {
    const buf = await readFile(row.path);
    res.writeHead(200, {
      "content-type": row.mime,
      "content-length": buf.length,
      "cache-control": "private, max-age=86400"
    });
    res.end(buf);
  } catch {
    json(res, 404, { error: "photo_missing" });
  }
}

async function deleteReport(user, id, res) {
  if (!requireFeature(user, "reports", res)) return;
  if (!requireRole(user, ["owner", "dispatch"], res)) return;
  const owned = db.prepare("SELECT 1 FROM reports WHERE id = ? AND account_id = ?").get(id, user.account_id);
  if (!owned) return json(res, 404, { error: "no_such_report" });
  db.prepare("DELETE FROM reports WHERE id = ?").run(id);   // photos cascade
  await rm(join(PHOTO_DIR, id), { recursive: true, force: true });
  json(res, 200, { ok: true });
}

function markReportInvoiced(req, user, id, body, res) {
  db.prepare("UPDATE reports SET invoice_id = ? WHERE id = ? AND account_id = ?")
    .run(String(body.invoiceId || ""), id, user.account_id);
  json(res, 200, { ok: true });
}

/* -------------------------------------------------------------- users --- */

async function createTeamUser(req, user, res) {
  if (!requireFeature(user, "accounts", res)) return;
  if (!requireRole(user, ["owner"], res)) return;

  const { email, name, password, role } = await readJson(req);
  if (!email || !name || !password) return json(res, 400, { error: "email_name_password_required" });
  if (String(password).length < 8) return json(res, 400, { error: "password_too_short", min: 8 });
  if (userByEmail(email)) return json(res, 409, { error: "email_taken" });

  const seats = db.prepare("SELECT COUNT(*) AS c FROM users WHERE account_id = ?").get(user.account_id).c;
  const max = planOf(user.plan).limits.seats;
  if (seats >= max) return json(res, 402, { ...lockedPayload("accounts"), error: "seat_limit", seats, max });

  const id = createUser({
    accountId: user.account_id, email, name, password,
    role: ["owner", "dispatch", "driver"].includes(role) ? role : "driver"
  });
  json(res, 201, { id });
}

function listTeam(user, res) {
  if (!requireFeature(user, "accounts", res)) return;
  const rows = db.prepare(`SELECT id, email, name, role, active, last_seen, created_at
                           FROM users WHERE account_id = ? ORDER BY created_at`).all(user.account_id);
  json(res, 200, { users: rows, seats: rows.length, max: planOf(user.plan).limits.seats });
}

async function updateTeamUser(req, user, id, res) {
  if (!requireFeature(user, "accounts", res)) return;
  if (!requireRole(user, ["owner"], res)) return;
  const body = await readJson(req);
  const target = db.prepare("SELECT * FROM users WHERE id = ? AND account_id = ?").get(id, user.account_id);
  if (!target) return json(res, 404, { error: "no_such_user" });

  if (body.password) {
    if (String(body.password).length < 8) return json(res, 400, { error: "password_too_short", min: 8 });
    setPassword(id, body.password);
  }
  if (body.active != null) {
    // Never let the last owner lock themselves out.
    if (!body.active && target.role === "owner") {
      const owners = db.prepare("SELECT COUNT(*) AS c FROM users WHERE account_id = ? AND role = 'owner' AND active = 1")
        .get(user.account_id).c;
      if (owners <= 1) return json(res, 400, { error: "last_owner" });
    }
    db.prepare("UPDATE users SET active = ? WHERE id = ?").run(body.active ? 1 : 0, id);
    if (!body.active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  }
  if (body.role && ["owner", "dispatch", "driver"].includes(body.role)) {
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(body.role, id);
  }
  json(res, 200, { ok: true });
}

/* ------------------------------------------------------------- portal --- */

async function shareInvoice(req, user, res) {
  if (!requireFeature(user, "portal", res)) return;
  const { invoice, client, settings } = await readJson(req);
  if (!invoice || !invoice.id) return json(res, 400, { error: "invoice_required" });

  const existing = db.prepare("SELECT token FROM shares WHERE account_id = ? AND invoice_id = ?")
    .get(user.account_id, invoice.id);
  const token = existing ? existing.token : randomBytes(18).toString("base64url");
  const doc = JSON.stringify({ invoice, client, settings });

  if (existing) db.prepare("UPDATE shares SET doc = ? WHERE token = ?").run(doc, token);
  else db.prepare("INSERT INTO shares (token, account_id, invoice_id, doc, created_at) VALUES (?,?,?,?,?)")
        .run(token, user.account_id, invoice.id, doc, now());

  json(res, 200, { token, path: "/p/" + token });
}

function shareStats(user, res) {
  if (!requireFeature(user, "portal", res)) return;
  const rows = db.prepare(`SELECT invoice_id, token, views, last_view, created_at
                           FROM shares WHERE account_id = ?`).all(user.account_id);
  json(res, 200, { shares: rows });
}

/* The customer-facing page. No login: the token is the credential, so it is
   long and random, and the page carries noindex. */
function publicInvoice(token, res) {
  const row = db.prepare("SELECT doc FROM shares WHERE token = ?").get(token);
  if (!row) return text(res, 404, "<h1>That invoice link is not valid.</h1>");

  db.prepare("UPDATE shares SET views = views + 1, last_view = ? WHERE token = ?").run(now(), token);

  const { invoice, client, settings } = JSON.parse(row.doc);
  const cents = (v) => {
    const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
    return isNaN(n) ? 0 : Math.round(n * 100);
  };
  const money = (c) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const items = invoice.items || [];
  const sub = items.reduce((s, it) => s + Math.round((parseFloat(it.qty) || 0) * cents(it.rate)), 0);
  const total = sub + cents(invoice.adjustment);
  const paid = invoice.status === "paid";

  const rows = items.map((it) => `<tr>
      <td>${escapeHtml(it.desc)}</td>
      <td class="n">${escapeHtml(it.qty)}</td>
      <td class="n">${money(cents(it.rate))}</td>
      <td class="n">${money(Math.round((parseFloat(it.qty) || 0) * cents(it.rate)))}</td>
    </tr>`).join("");

  text(res, 200, `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Invoice ${escapeHtml(invoice.number)} — ${escapeHtml(settings?.bizName || "Wells Safety")}</title>
<style>
:root{--ink:#131820;--muted:#5b6675;--line:#e2e6ec;--amber:#ffb020;--asphalt:#0e1420}
*{box-sizing:border-box}
body{margin:0;background:#f7f8fa;color:var(--ink);
  font:400 15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
.sheet{max-width:800px;margin:2rem auto;background:#fff;border:1px solid var(--line);
  border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(14,20,32,.07)}
.top{background:var(--asphalt);color:#fff;padding:1.5rem 1.75rem;display:flex;
  justify-content:space-between;gap:1.5rem;flex-wrap:wrap;border-bottom:3px solid var(--amber)}
.top h1{margin:0;font-size:1.9rem;letter-spacing:.04em;text-transform:uppercase}
.top .biz{font-size:1.15rem;font-weight:700}
.top .meta{text-align:right;font-size:.9rem;opacity:.85}
.body{padding:1.75rem}
.parties{display:flex;gap:2.5rem;flex-wrap:wrap;margin-bottom:1.5rem}
h3{margin:0 0 .25rem;font-size:.7rem;letter-spacing:.11em;text-transform:uppercase;color:var(--muted)}
table{width:100%;border-collapse:collapse;margin-bottom:1.25rem}
th{text-align:left;font-size:.7rem;letter-spacing:.09em;text-transform:uppercase;
  color:var(--muted);border-bottom:2px solid var(--ink);padding:.5rem .4rem}
td{padding:.6rem .4rem;border-bottom:1px solid var(--line)}
.n{text-align:right;font-variant-numeric:tabular-nums}
.tot{margin-left:auto;width:min(340px,100%)}
.tot td{border:0;padding:.35rem .4rem}
.tot .grand td{border-top:2px solid var(--ink);font-size:1.3rem;font-weight:700;padding-top:.6rem}
.paid{display:inline-block;margin-top:1rem;border:2px solid #0f6b39;color:#0f6b39;
  padding:.5rem 1rem;border-radius:8px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
.due{display:inline-block;margin-top:1rem;background:var(--amber);color:var(--asphalt);
  padding:.6rem 1.1rem;border-radius:8px;font-weight:700}
.foot{border-top:1px solid var(--line);padding:1.25rem 1.75rem;font-size:.88rem;color:var(--muted)}
@media print{body{background:#fff}.sheet{border:0;box-shadow:none;margin:0}}
</style></head><body>
<div class="sheet">
  <div class="top">
    <div><div class="biz">${escapeHtml(settings?.bizName || "Wells Safety LLC")}</div>
      <div style="font-size:.88rem;opacity:.8">${escapeHtml(settings?.bizPhone || "")}<br>${escapeHtml(settings?.bizEmail || "")}</div></div>
    <div class="meta"><h1>Invoice</h1>#${escapeHtml(invoice.number)}<br>
      Issued ${escapeHtml(invoice.issued)}<br><strong>Due ${escapeHtml(invoice.due)}</strong></div>
  </div>
  <div class="body">
    <div class="parties"><div><h3>Bill to</h3><strong>${escapeHtml(client?.name || "")}</strong><br>
      ${escapeHtml(client?.contact || "")}</div>
      ${invoice.loadRef ? `<div><h3>Load</h3>${escapeHtml(invoice.loadRef)}</div>` : ""}
      ${invoice.origin ? `<div><h3>Route</h3>${escapeHtml(invoice.origin)} &rarr; ${escapeHtml(invoice.destination || "")}</div>` : ""}
    </div>
    <table><thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <table class="tot">
      <tr><td>Subtotal</td><td class="n">${money(sub)}</td></tr>
      ${cents(invoice.adjustment) ? `<tr><td>${escapeHtml(invoice.adjustmentNote || "Adjustment")}</td><td class="n">${money(cents(invoice.adjustment))}</td></tr>` : ""}
      <tr class="grand"><td>Total due</td><td class="n">${money(total)}</td></tr>
    </table>
    ${paid ? `<div class="paid">Paid ${escapeHtml(invoice.paidDate || "")}</div>`
           : `<div class="due">Amount due ${money(total)}</div>`}
  </div>
  <div class="foot">${escapeHtml(settings?.remit || "")}
    ${invoice.notes ? "<br><br>" + escapeHtml(invoice.notes) : ""}</div>
</div></body></html>`);
}

/* ------------------------------------------------------------- router --- */

export async function route(req, res, url) {
  const p = url.pathname;

  // Public customer invoice link.
  if (req.method === "GET" && p.startsWith("/p/")) {
    return publicInvoice(p.slice(3), res);
  }

  if (p === "/api/health") return json(res, 200, { ok: true, time: now() });

  if (p === "/api/auth/login" && req.method === "POST") return login(req, res);

  if (p === "/api/auth/logout" && req.method === "POST") {
    endSession(cookies(req)[COOKIE]);
    setCookie(res, COOKIE, "", { clear: true });
    return json(res, 200, { ok: true });
  }

  if (p === "/api/auth/me") {
    const user = userForToken(cookies(req)[COOKIE]);
    return json(res, 200, user ? { user: publicUser(user) } : { user: null, catalogue: PLANS, featureCopy: FEATURE_COPY });
  }

  // Everything past here needs a session.
  const user = requireUser(req, res);
  if (!user) return;

  if (p === "/api/book" && req.method === "GET") return getBook(user, res);
  if (p === "/api/book" && req.method === "PUT") return putBook(req, user, res);

  if (p === "/api/reports" && req.method === "GET") return listReports(user, res);
  if (p === "/api/reports" && req.method === "POST") return postReport(req, user, res);

  let m;
  if ((m = /^\/api\/reports\/([\w-]+)\/photos\/(\d+)$/.exec(p)) && req.method === "GET") {
    return getPhoto(user, m[1], m[2], res);
  }
  if ((m = /^\/api\/reports\/([\w-]+)$/.exec(p))) {
    if (req.method === "DELETE") return deleteReport(user, m[1], res);
    if (req.method === "PATCH") return markReportInvoiced(req, user, m[1], await readJson(req), res);
  }

  if (p === "/api/team" && req.method === "GET") return listTeam(user, res);
  if (p === "/api/team" && req.method === "POST") return createTeamUser(req, user, res);
  if ((m = /^\/api\/team\/([\w-]+)$/.exec(p)) && req.method === "PATCH") {
    return updateTeamUser(req, user, m[1], res);
  }

  if (p === "/api/share" && req.method === "POST") return shareInvoice(req, user, res);
  if (p === "/api/share" && req.method === "GET") return shareStats(user, res);

  return json(res, 404, { error: "no_such_route" });
}

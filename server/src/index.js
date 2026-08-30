/* ==========================================================================
   Wells Safety API — entry point.

   Zero npm dependencies: node:http, node:crypto and node:sqlite only.
   Optionally serves the static site from STATIC_DIR so one container can
   host both the marketing pages and the API on the same origin, which keeps
   the session cookie first-party and sidesteps CORS entirely.
   ========================================================================== */

import { createServer } from "node:http";
import { route } from "./routes.js";
import { serveStatic, json } from "./http.js";
import { db } from "./db.js";
import { createAccount, createUser, userByEmail } from "./auth.js";

const PORT = Number(process.env.PORT || 8080);
const STATIC_DIR = process.env.STATIC_DIR || "";

/* First boot: create the owner from the environment so there is no default
   password anywhere and no open sign-up endpoint to abuse. */
function bootstrap() {
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;
  if (!email || !password) return;
  if (userByEmail(email)) return;

  if (String(password).length < 8) {
    console.error("OWNER_PASSWORD must be at least 8 characters — owner not created.");
    return;
  }
  const accountId = createAccount({
    name: process.env.ACCOUNT_NAME || "Wells Safety LLC",
    plan: process.env.ACCOUNT_PLAN || "starter"
  });
  createUser({
    accountId, email, password,
    name: process.env.OWNER_NAME || "Owner",
    role: "owner"
  });
  console.log(`Created owner ${email} on plan ${process.env.ACCOUNT_PLAN || "starter"}.`);
}
bootstrap();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "same-origin");
  res.setHeader("x-frame-options", "SAMEORIGIN");

  try {
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/p/")) {
      await route(req, res, url);
      return;
    }
    if (await serveStatic(STATIC_DIR, url.pathname, res)) return;
    if (STATIC_DIR && await serveStatic(STATIC_DIR, "/index.html", res)) return;
    json(res, 404, { error: "not_found" });
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(req.method, url.pathname, err);
    if (!res.headersSent) json(res, status, { error: err.status ? err.message : "server_error" });
  }
});

server.listen(PORT, () => {
  console.log(`Wells Safety API on :${PORT}` + (STATIC_DIR ? ` (serving ${STATIC_DIR})` : ""));
});

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    server.close(() => { try { db.close(); } catch {} process.exit(0); });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

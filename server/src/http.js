/* ==========================================================================
   Wells Safety API — small helpers over node:http. No framework.
   ========================================================================== */

import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const MAX_BODY = Number(process.env.MAX_BODY_MB || 25) * 1024 * 1024;

export function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...headers
  });
  res.end(body);
}

export function text(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

/* Reads a JSON body, refusing anything oversized before it is buffered. */
export function readJson(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > MAX_BODY) return reject(Object.assign(new Error("too large"), { status: 413 }));

    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(Object.assign(new Error("bad json"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

export function cookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, { maxAge, clear } = {}) {
  // Built as a list and joined once. Assembling this by string concatenation
  // is how a Secure flag quietly goes missing in production.
  const parts = [`${name}=${clear ? "" : encodeURIComponent(value)}`];
  parts.push("Path=/");
  parts.push("HttpOnly");
  parts.push("SameSite=Lax");
  if (process.env.INSECURE_COOKIES !== "1") parts.push("Secure");
  parts.push(`Max-Age=${clear ? 0 : (maxAge || 0)}`);

  const header = parts.join("; ");
  const prev = res.getHeader("set-cookie");
  res.setHeader("set-cookie", prev ? [].concat(prev, header) : [header]);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml"
};

/* Serves the static site sitting next to the API, if STATIC_DIR is set. */
export async function serveStatic(root, urlPath, res) {
  if (!root) return false;
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel.endsWith("/")) rel += "index.html";
  // Contain the path: normalise, then refuse anything that climbs out.
  const full = join(root, normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!full.startsWith(root)) return false;

  try {
    const info = await stat(full);
    if (!info.isFile()) return false;
    const body = await readFile(full);
    const ext = extname(full).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "content-length": body.length,
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

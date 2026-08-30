# Wells Safety dispatch server

A small Node service that turns the Dispatch Book from a browser-only tool into
a real shared system: books that sync across devices, driver reports that file
themselves, per-person logins, and private invoice links for customers.

**No npm dependencies.** It uses `node:http`, `node:crypto` and `node:sqlite`,
all built into Node 22.5+. There is no install step, no lockfile, and nothing to
audit or keep patched.

The container also serves the static site, so the marketing pages, the admin and
the API all share one origin. That keeps the session cookie first-party and
means CORS never comes up.

---

## Deploy

```sh
git clone <this repo> wellssafety && cd wellssafety/server
cp .env.example .env
$EDITOR .env                 # set OWNER_PASSWORD at minimum
docker compose up -d --build
```

It listens on `127.0.0.1:8080`. Put a TLS terminator in front — Caddy is two
lines:

```
wellssafety.com {
    reverse_proxy 127.0.0.1:8080
}
```

or nginx:

```nginx
server {
    server_name wellssafety.com;
    client_max_body_size 30M;          # driver photo uploads
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Serve it over https.** Session cookies are set `Secure`, so login silently
fails over plain http. For a LAN test only, set `INSECURE_COOKIES=1`.

### First boot

The owner account is created once, from the environment — there is no open
sign-up endpoint and no default password anywhere. After that the variables are
ignored; change a password from the app, not by editing `.env`.

### Backups

Everything lives in the `wellssafety-data` volume: `wellssafety.db` plus the
`photos/` directory.

```sh
docker run --rm -v wellssafety-data:/data -v "$PWD:/out" alpine \
  tar czf /out/wellssafety-backup-$(date +%F).tar.gz -C /data .
```

Run that on a cron. SQLite is in WAL mode, so copying the volume while the
service is running is safe enough for nightly snapshots; stop the container
first if you want a guaranteed-clean copy.

---

## Plans

Gating is enforced **server-side on every request**, not by hiding buttons. A
locked feature answers `402` with the plan that unlocks it, and the client turns
that into the upgrade panel.

| | Starter | Pro | Fleet |
| --- | --- | --- | --- |
| Invoices, printing, driver form | ● | ● | ● |
| Books sync across devices | | ● | ● |
| Logins per person | | ● | ● |
| Driver reports file themselves | | ● | ● |
| Customer invoice links + view tracking | | | ● |
| Seats | 1 | 6 | 25 |
| Photo storage | — | 2 GB | 20 GB |

Change an account's plan:

```sh
docker compose exec api node -e "
  const {DatabaseSync} = require('node:sqlite');
  new DatabaseSync('/data/wellssafety.db')
    .prepare(\"UPDATE accounts SET plan = ? WHERE name = ?\")
    .run('pro', 'Wells Safety LLC');
"
```

Wire that same statement to a Stripe webhook when you want billing to drive it.
Plan definitions and the upgrade copy live in `src/plans.js`.

---

## API

Everything under `/api` except `health`, `auth/login` and `auth/me` needs a
session cookie.

| Method | Path | Plan | Notes |
| --- | --- | --- | --- |
| GET | `/api/health` | — | liveness |
| POST | `/api/auth/login` | — | throttled: 8 tries per 15 min |
| POST | `/api/auth/logout` | — | |
| GET | `/api/auth/me` | — | current user, plan and the plan catalogue |
| GET | `/api/book` | pro | the whole book, with its version |
| PUT | `/api/book` | pro | send `baseVersion`; `409` if another device wrote first |
| GET | `/api/reports` | pro | newest 500 |
| POST | `/api/reports` | pro | report + photos as data URLs; duplicate ids are a no-op |
| GET | `/api/reports/:id/photos/:n` | pro | |
| PATCH | `/api/reports/:id` | pro | link an invoice id |
| DELETE | `/api/reports/:id` | pro | owner/dispatch only |
| GET/POST | `/api/team` | pro | list / create users, owner only to create |
| PATCH | `/api/team/:id` | pro | password, role, activate/deactivate |
| POST | `/api/share` | fleet | mint a customer link for an invoice |
| GET | `/api/share` | fleet | view counts |
| GET | `/p/:token` | fleet | the customer-facing invoice page, no login |

---

## Security notes

What is actually enforced, and what is not:

- **Passwords** — scrypt (N=16384) with a per-user salt, compared in constant
  time. Minimum 8 characters. Changing a password ends every other session for
  that user.
- **Sessions** — 32 random bytes in an httpOnly, SameSite=Lax, Secure cookie.
  Nothing about the user is encoded in the token, so a stolen cookie cannot be
  edited into a different role. Deactivating a user drops their sessions
  immediately.
- **Tenancy** — every query is scoped by `account_id`. Verified: a second
  account cannot read another's book, list or delete its reports, fetch a photo
  by a known id, or see its roster.
- **Roles** — `owner` manages the team; `owner`/`dispatch` write the book;
  `driver` can file reports and nothing else. The last active owner cannot be
  deactivated.
- **Login throttling** — 8 failures per email+IP per 15 minutes, in memory.
  Resets on restart, which is fine for a single-tenant box; put fail2ban or
  Cloudflare in front if it is ever exposed to real abuse.
- **Uploads** — only `data:image/(jpeg|png|webp)` is accepted, capped by
  `MAX_BODY_MB` (25 by default) and by the plan's storage limit.
- **Static files** — paths are normalised and confined to `STATIC_DIR`;
  traversal attempts (`../`, encoded, and doubled forms) were tested and 404.
- **Report ids** — an id becomes a directory name under `PHOTO_DIR`, so it is
  restricted to `[A-Za-z0-9_-]{1,64}`; anything else is replaced with a
  generated id. Every photo path is then re-resolved and rejected if it lands
  outside `PHOTO_DIR`. Tested with `../`, encoded, doubled and absolute forms.
- **Filed reports** — normalised on ingest to known fields, with strings capped
  and coordinates coerced to numbers. Reports are written by drivers, the
  least-trusted role, and rendered in the owner's admin, so they are escaped at
  render as well.

**The shared passcode on `/admin.html` and `/driver.html` is not part of this.**
It is a client-side check that keeps the pages away from anyone who stumbles
onto the URL. Real access control is the login above — that is what the server
actually checks.

Customer invoice links are unguessable (18 random bytes) and carry `noindex`,
but anyone holding the link can view that invoice. Treat a link as the
credential, and do not reuse one across customers.

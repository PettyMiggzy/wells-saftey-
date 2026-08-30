# Wells Safety — pilot car & escort services website

Static marketing site for **wellssafety.com** — Wells Safety LLC, a
veteran-owned pilot car and escort company based in Martinsville, Indiana,
running oversize, overweight and superload escorts in all 48 states.

No build step, no framework, no dependencies. Open `index.html` or upload the
folder to any host.

## Business details

Confirmed by the owner and reflected throughout the site:

- **Wells Safety LLC**, Martinsville, Indiana
- **Dispatch: (765) 684-1909**, 24/7
- Operates in **all 48 contiguous states**
- Veteran owned; founder is a retired police officer
- Certifications: **PEVO**, **ATSSA** flagger, **WITPAC**, **TIMS**

### Still to confirm

| Item | Current value | Action |
| --- | --- | --- |
| Dispatch email | `paul@wellssafety.com` | Added as requested and wired to the quote form — **but `wellssafety.com` is not paid up, so it cannot receive mail yet.** It starts working the moment the domain is live. |
| Insurance limits | Stated as "commercial auto and general liability", no figure | Add the real limits if you want them shown |

Fabricated client testimonials were removed rather than left on a live business
site. If you want a proof section back, supply real quotes with a name and
company and it can be added.

## Pages

| File | Purpose |
| --- | --- |
| `index.html` | Home — hero, credentials, services, why us, process, certifications, gallery |
| `services.html` | Lead/chase, height pole, route survey, superload, FAQ |
| `coverage.html` | All 48 states, certification states, multi-state routes |
| `about.html` | Ownership story, credentials, equipment list |
| `contact.html` | Quote request form and dispatch details |

## Structure

```
css/styles.css      design system + all layout
css/fonts.css       @font-face for the self-hosted fonts
js/main.js          mobile nav, form validation, quote handoff
admin.html          private invoice ledger (unlinked, noindex)
css/admin.css       admin styling + the print stylesheet for invoices
js/admin.js         invoice/customer store, totals, aging, export
assets/             imagery, favicon, fonts
```

Fonts (Inter, Barlow Condensed) are self-hosted in `assets/fonts/` rather than
loaded from a CDN — faster, no third-party requests, and the page renders
identically offline.

## The quote form

`contact.html` has no backend. On submit, `js/main.js` validates the fields and
then hands the request off based on the form's `data-email` attribute:

- **Set** — opens the visitor's email client with the request pre-filled
- **Empty** (current state, since the domain mailbox is dead) — copies the
  request to the clipboard and tells the visitor to call or text dispatch

To take submissions server-side instead, point the form at a form service
(Formspree, Netlify Forms, Basin) or your own endpoint and replace the handoff
at the end of `js/main.js`.

A honeypot field (`.hp`) catches naive spam bots. Keep it if you swap the
backend.

## Imagery

All photography in `assets/` is real — Wells Safety's own trucks and loads,
supplied by the owner. Sources were 2048x1536; they are cropped to the aspect
ratio each slot needs and saved as WebP at quality 84.

To add more, drop the originals somewhere and re-run the crop script pattern in
`assets/` — crop to 16:9 for the hero, 3:2 for cards and gallery, and roughly
2.3:1 for the CTA banner.

There is no longer any AI-generated imagery on the site.

## Dispatch Book (private admin)

`admin.html` is an invoice ledger for running the business — open balances,
overdue chasing, and printable invoices. It is **not linked from the public
site**, is `noindex`, and is disallowed in `robots.txt`. Bookmark the URL:

    https://wells-saftey.vercel.app/admin.html

What it does:

- **Dashboard** — outstanding, overdue, paid in the last 30 days, billed YTD;
  an aging table (not due / 1-30 / 31-60 / 61-90 / 90+) and who owes the most
- **Invoices** — search and filter by status, mark paid in one click, CSV export
- **Customers** — brokers and carriers with payment terms; per-customer open and
  billed totals; "Invoice" button prefills a new invoice on their terms
- **Print / PDF** — a clean invoice with your details, the load and permit
  reference, line items, totals and a PAID stamp. Print to PDF and email it.
- **Rates** — per-mile defaults for lead, chase, high pole, steer, survey,
  deadhead and fuel, plus day rate, wait time and per diem. Quick-add buttons on
  an invoice pull from these; override any line per job.

### Where the data lives — read this

Everything is stored in **that one browser only** (`localStorage`). Nothing is
uploaded, so there is no login and no server to leak — but it also means:

- Clearing browsing data **erases it**
- It does not sync between his phone and his laptop
- Two devices keep two separate books

So **download a backup regularly** (Settings → Download backup) and keep it in
Drive or email it to himself. Restore reads that same file back.

If he outgrows this — needs it on multiple devices, or wants a real login — the
next step is a hosted database behind Vercel, which needs an account and a small
amount of backend work. The data model is a straight JSON document, so it ports
over cleanly.

## Crew tools

Both private pages sit behind a shared passcode (default **104Paul**, changeable
in Settings → Passcode).

### Drivers

The **Drivers** tab is a roster with credential expiry tracking — PEVO, ATSSA
flagger, WITPAC, TIMS, medical card and insurance. Anything inside 60 days, or
already lapsed, is pushed to the top of the dashboard, worst first. A lapsed
card parks a driver, so this is the part worth keeping current.

### Driver job reports — `driver.html`

A four-step, thumb-sized form drivers fill out on their phone: who ran it, the
run (roles, route, miles, deadhead, wait, nights), photo proof straight from the
camera, then review and send. It stamps GPS coordinates on request.

**How it gets to the office.** A driver's phone shares no storage with the
office, and there is no server in between. So "Send to dispatch" opens the
phone's own share sheet with the report (JSON) and photos attached — the driver
texts or emails it. Photos are resized to 1400px and re-encoded, which takes a
4MB camera shot down to roughly 100KB so it actually sends.

On the office end, **Reports → Import a report** reads the JSON back in.
Re-importing the same report is detected and skipped.

### Report → invoice

Open an imported report and hit **Make an invoice from this**. It prices the run
off your saved rates — each role billed against the loaded miles, plus deadhead,
wait time and per diem — and matches the customer by name if you already have
them. Verified: a 150-mile lead + high pole run with 40 deadhead, 2 hours wait
and 1 night came out at $1,082.50 without a keystroke.

### What the passcode actually does

It is a **client-side** check: the page holds a SHA-256 hash and compares what
you type against it. That keeps the passcode out of the source and keeps the
tools away from anyone who stumbles onto the URL.

It is **not authentication.** Anyone who reads the page source can lift the hash,
or skip the gate entirely in developer tools. What genuinely limits the exposure
is that the data never leaves the browser it was entered in — there is no server
holding it for someone to reach. Treat the gate as a lock on a filing cabinet,
not a bank vault. Real accounts need a backend.

## Domain

The site currently points at `https://wells-saftey.vercel.app` — canonical
tags, Open Graph URLs, JSON-LD and `sitemap.xml`. The `wellssafety.com` domain
is not active yet.

When it is paid up and pointed at Vercel, switch every absolute URL back:

```sh
grep -rl 'wells-saftey.vercel.app' . --include='*.html' --include='*.xml' --include='*.txt' \
  | xargs sed -i 's|https://wells-saftey.vercel.app|https://wellssafety.com|g'
```

Then restore a dispatch email: set `data-email` on the quote form in
`contact.html`, and add the address back to the footer and contact page. While
`data-email` is empty the form copies the request to the clipboard and directs
the visitor to call or text instead of opening a mail client.

## Deploying

Any static host works — GitHub Pages, Netlify, Cloudflare Pages, S3, or plain
nginx. Upload the repository contents as-is; `index.html` is the entry point.

If the site moves to another host, update the absolute URLs in each page's
`<link rel="canonical">`, Open Graph tags and `sitemap.xml` — see **Domain**
above for the one-command swap.

Do not add a `vercel.json`. One was tried and it broke the build: production
stopped at the commit immediately before it and only recovered once the file
was removed. Vercel serves this repo correctly with no configuration at all.

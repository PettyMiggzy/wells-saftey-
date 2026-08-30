# Wells Safety — pilot car & escort services website

Static marketing site for **wellssafety.com**, a veteran-owned pilot car and
escort vehicle company serving oversize, overweight and superload transport.

No build step, no framework, no dependencies. Open `index.html` or upload the
folder to any host.

## ⚠️ Replace before launch

The site ships with placeholder contact details. Search and replace these
across all `.html` files:

| Placeholder | Appears as | Replace with |
| --- | --- | --- |
| `(555) 555-0142` | Displayed phone number | Real dispatch number |
| `+15555550142` | `tel:` links | Real number, E.164 format |
| `+1-555-555-0142` | JSON-LD `telephone` in `index.html` | Real number |
| `dispatch@wellssafety.com` | Email links and the quote form target | Real dispatch inbox |

Also review and confirm before publishing, since these are business claims:

- The stat strip on the home page — `24/7`, `18+ states`, `$1M`, `100%`
- The state list in `coverage.html` — must match actual certifications
- Insurance figures in `about.html` and the credentials band
- The three testimonials on the home page are **illustrative placeholders**.
  Replace them with real client quotes or delete the section.

## Pages

| File | Purpose |
| --- | --- |
| `index.html` | Home — hero, credentials, services, why us, process, testimonials |
| `services.html` | Lead/chase, height pole, route survey, superload, FAQ |
| `coverage.html` | Certified states, reciprocity, multi-state routes |
| `about.html` | Ownership story, credentials, equipment list |
| `contact.html` | Quote request form and dispatch details |

## Structure

```
css/styles.css      design system + all layout
css/fonts.css       @font-face for the self-hosted fonts
js/main.js          mobile nav, form validation, mailto handoff
assets/             imagery, favicon, fonts
```

Fonts (Inter, Barlow Condensed) are self-hosted in `assets/fonts/` rather than
loaded from a CDN — faster, no third-party requests, and the page renders
identically offline.

## The quote form

`contact.html` has no backend. On submit, `js/main.js` validates the fields and
then opens the visitor's email client with the request pre-filled, addressed to
the `data-email` attribute on the form.

That works on any static host, but it depends on the visitor having a mail
client configured. To take submissions server-side instead, point the form at a
form service (Formspree, Netlify Forms, Basin) or your own endpoint, and drop
the `mailto` branch at the end of `js/main.js`.

A honeypot field (`.hp`) catches naive spam bots. Keep it if you swap the
backend.

## Imagery

Photography in `assets/` was generated with the Venice image API. To regenerate
or add images, put your key in `.env` (already gitignored — copy `.env.example`)
and call the API with it. **Never commit `.env` or paste a key into tracked
files.**

## Deploying

Any static host works — GitHub Pages, Netlify, Cloudflare Pages, S3, or plain
nginx. Upload the repository contents as-is; `index.html` is the entry point.

Update the `https://wellssafety.com/` URLs in each page's `<link rel="canonical">`,
Open Graph tags and `sitemap.xml` if the site lives on a different domain.

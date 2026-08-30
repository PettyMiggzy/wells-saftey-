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
| Dispatch email | **removed** | `wellssafety.com` is not paid up, so the mailbox cannot receive mail. Give a working address to wire the quote form to |
| Insurance limits | Stated as "commercial auto and general liability", no figure | Add the real limits if you want them shown |

Fabricated client testimonials were removed rather than left on a live business
site. If you want a proof section back, supply real quotes with a name and
company and it can be added.

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

All photography in `assets/` is real — Wells Safety's own trucks and loads,
supplied by the owner. Sources were 2048x1536; they are cropped to the aspect
ratio each slot needs and saved as WebP at quality 84.

To add more, drop the originals somewhere and re-run the crop script pattern in
`assets/` — crop to 16:9 for the hero, 3:2 for cards and gallery, and roughly
2.3:1 for the CTA banner.

There is no longer any AI-generated imagery on the site.

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

Update the `https://wellssafety.com/` URLs in each page's `<link rel="canonical">`,
Open Graph tags and `sitemap.xml` if the site lives on a different domain.

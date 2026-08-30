# Wells Safety — pilot car & escort services website

Static marketing site for **wellssafety.com** — Wells Safety LLC, a
veteran-owned pilot car and escort company based in Martinsville, Indiana,
running oversize, overweight and superload escorts in all 48 states.

No build step, no framework, no dependencies. Open `index.html` or upload the
folder to any host.

## ⚠️ Confirm before launch

Contact details are the real ones read off the trucks — **Wells Safety LLC,
Martinsville, IN, (765) 684-1909**. Two things still need confirming:

| Item | Current value | Action |
| --- | --- | --- |
| Dispatch email | `dispatch@wellssafety.com` | Confirm this inbox exists, or swap it |
| Testimonials | Three quotes on the home page | **Illustrative placeholders** — replace with real client quotes or delete the section |

Also confirm these business claims, since they are stated as fact on the site:

- Stat strip on the home page — `24/7`, `48 states`, `$1M`, `100% clean safety record`
- `$1,000,000` commercial auto liability, in the credentials band and `about.html`
- Certification and training claims in `about.html` (flagger, first aid, CPR)
- Veteran and retired-law-enforcement ownership framing throughout

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

## Deploying

Any static host works — GitHub Pages, Netlify, Cloudflare Pages, S3, or plain
nginx. Upload the repository contents as-is; `index.html` is the entry point.

Update the `https://wellssafety.com/` URLs in each page's `<link rel="canonical">`,
Open Graph tags and `sitemap.xml` if the site lives on a different domain.

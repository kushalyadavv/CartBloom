# Build prompt — cartbloom.space

Hand this to your site-building tool verbatim. Everything factual in it is true
of the shipped app; the constraints near the end exist because the site will be
linked from a Shopify App Store listing that gets reviewed.

---

## THE PROMPT

Build a marketing website for **CartBloom**, a Shopify app, at **cartbloom.space**.

Three pages: **Home**, **Pricing**, **Privacy Policy**.

### Stack and quality bar

- **Next.js (App Router) + TypeScript + Tailwind CSS.**
- **Framer Motion** for all animation. Use it with restraint and intent:
  scroll-triggered reveals with `whileInView` and `viewport={{ once: true }}`,
  staggered children on feature grids, a subtle parallax on the hero visual,
  spring physics on interactive elements. Every animation should have a reason.
  No confetti, no bouncing, nothing that fires twice.
- **Respect `prefers-reduced-motion`** — wrap motion in a hook that disables
  transforms and keeps opacity fades only. This is an accessibility requirement,
  not a nicety.
- Fully responsive, mobile-first. Test at 360px, 768px, 1280px, 1920px.
- **Lighthouse 95+ on all four categories.** Self-host fonts via `next/font`,
  serve images through `next/image` in AVIF/WebP, no layout shift.
- Semantic HTML, real heading hierarchy, visible focus rings, WCAG AA contrast
  in both themes. Keyboard-navigable throughout.
- **Dark and light mode**, respecting system preference with a manual toggle.
- Full SEO: per-page metadata, Open Graph and Twitter cards, `sitemap.xml`,
  `robots.txt`, JSON-LD `SoftwareApplication` schema on Home.

### Visual direction

Modern SaaS, closer to Linear or Vercel than to a template marketplace. Confident
whitespace, a strict type scale, one accent colour used sparingly.

- **Palette:** a fresh green as the primary accent (the product's own progress
  fill), near-black and off-white neutrals, one warm secondary for highlights.
  Subtle gradient meshes in the hero only — not on every section.
- **Typography:** a geometric sans for headings (Satoshi, General Sans or Inter
  Display), a readable sans for body (Inter). Tight tracking on large headings.
- **Depth:** soft shadows, 1px borders at low opacity, glassmorphism *only* on
  the sticky nav. No drop shadows on everything.
- **Hero visual:** an animated recreation of the product — a cart progress bar
  filling left to right, three circular gift markers lighting up in sequence as
  it passes them, then a reward card sliding in. Build it in code with Framer
  Motion, not as a video or static image. Loop it slowly. This *is* the product,
  so it should be the most polished thing on the page.

---

### What CartBloom actually does — use this, do not embellish

CartBloom adds a **progress bar to the Shopify cart** that fills as shoppers add
items, with a reward at each milestone the merchant sets.

Core capabilities, all shipped:

1. **Multiple reward tiers per offer** — each tier can give free shipping, a
   percentage off the order, a fixed amount off, or a gift product.
2. **Shopper-chosen gifts.** When a tier offers gifts, the shopper picks from the
   products the merchant selected, in a modal with product images — rather than
   being assigned one.
3. **Merchant-controlled claim rules.** The merchant decides whether shoppers
   keep a gift from *every* tier they unlock, or only *one* in total. When it is
   only one, they choose whether that is the highest-value tier reached, one
   specific pinned tier, or the shopper's own choice.
4. **Design control in-app** — colours, font sizes in pixels, font weights,
   per-side padding, corner radius, layout (milestone markers or a plain bar),
   and colour presets. No CSS editing.
5. **Live preview with a cart-value slider.** The merchant drags a slider from
   zero past the top tier and watches tiers unlock and the gift chooser appear —
   confirming a configuration without placing a test order. The preview runs the
   real storefront rendering code, so it cannot drift from what shoppers see.
6. **Placement** in the cart drawer and on the cart page, with a copyable snippet
   for themes that need the widget positioned by hand.
7. **A six-step setup wizard** — Trigger, Tiers, Gifts, Design, Placement,
   Review — where the Review step states the offer back in plain language
   ("Customers keep the gift from every tier they unlock") rather than echoing
   the settings.

Engineering points that are true and worth stating plainly on the site, because
they are unusual and verifiable:

- **The storefront widget makes zero requests to CartBloom's servers.** The
  offer configuration is delivered by Shopify itself, inlined into the page. The
  app cannot slow a storefront down or go down with it.
- **Entitlement is decided by a Shopify Function written in Rust**, running
  inside Shopify's checkout. A shopper who tampers with the cart to fake a gift
  is billed full price, because the storefront never decides who is entitled to
  what.
- **CartBloom requests no access to customers or orders**, and stores no personal
  data about shoppers. Tier targeting by customer tag is evaluated inside
  Shopify's own discount function, which answers yes or no without ever handing
  the app a customer record.

### Home page sections

1. **Sticky nav** — logo, Features, Pricing, Privacy, and a primary
   "Install on Shopify" button. Glassmorphic on scroll.
2. **Hero** — headline, one-sentence subhead, primary CTA, and the animated
   progress-bar visual described above.
   - Headline: *Turn "add one more thing" into a reason to.*
   - Subhead: *CartBloom shows shoppers exactly what they unlock next — and lets
     them choose the gift.*
3. **How it works** — three steps, animated on scroll: *Set your tiers* → *Pick
   the gifts* → *Publish*. Small illustrative UI fragments, not stock icons.
4. **Feature grid** — the seven capabilities above. Bento-style layout, uneven
   cell sizes, hover elevation.
5. **The gift chooser** — a section devoted to feature 2 and 3, since that is the
   differentiator. Show the modal and explain claim rules in plain language.
6. **Built to stay out of the way** — the three engineering points. Present them
   as trust signals, quietly and without jargon.
7. **Pricing preview** — three cards, linking to /pricing.
8. **FAQ** — accordion, Framer Motion height animation. Real questions:
   *Does it work with my theme?* *Will it slow my store down?* *Can shoppers
   cheat the gift?* *What data do you collect?* *Can I try it free?*
9. **Footer** — links, support email, privacy policy, and a line stating
   CartBloom is an independent app not affiliated with Shopify Inc.

### Pricing page

Three plans, monthly. All features on every plan — the plans differ only in
volume. Say that explicitly; it is a selling point.

| | **Free** | **Growth** | **Pro** |
|---|---|---|---|
| Price | $0 | **$6.99/mo** | **$14.99/mo** |
| Free trial | — | **7 days** | **7 days** |
| Live offers | 1 | 5 | 25 |
| Tiers per offer | 3 | 6 | 12 |
| Draft offers | Unlimited | Unlimited | Unlimited |
| Every design, gift and claim-rule feature | ✓ | ✓ | ✓ |

- Mark **Growth** as the recommended plan.
- State that Growth and Pro both include a **7-day free trial**, no card
  charged until it ends. Free has no trial because it is not a subscription —
  it is simply free forever.
- State that billing is handled by Shopify and appears on the merchant's regular
  Shopify invoice.
- State that downgrading never stops a running offer — existing offers keep
  working; only publishing new ones past the new limit is paused. **This is true
  and it is reassuring, so say it.**
- FAQ below the table: *How does billing work?* *What happens if I downgrade?*
  *Is there a free trial?* (yes — 7 days on Growth and Pro, and the Free plan
  itself never expires, so there is always a no-cost way to keep using CartBloom
  after the trial).

### Privacy Policy page

Write a real policy from the facts below. Clean typographic treatment, anchored
section navigation, last-updated date. **Do not use a generic template** — a
policy claiming data collection that does not happen is as much a problem as one
that hides collection.

**What CartBloom stores:**
- The merchant's offer configurations (tiers, thresholds, selected gift products,
  design settings).
- A Shopify access token for the store, so the app can write those offers to it.
- A record of each publish, so a merchant can roll back.
- Session records for the embedded admin.

**What CartBloom does not do:**
- Requests only two Shopify permissions: `write_discounts` and `read_products`.
- Requests **no** access to customers or orders, and receives none.
- Stores no shopper personal data — no names, emails, addresses or order history.
- Sets no cookies for authentication and no tracking or advertising cookies.
- Runs no analytics or third-party trackers on merchant storefronts.
- Sells or shares nothing with anyone.

**Where and how:**
- Hosted on Cloudflare Workers with data in Cloudflare D1, encrypted at rest and
  in transit over TLS.
- Storefront shoppers never contact CartBloom's servers; the widget is served by
  Shopify.

**Retention and deletion:**
- Uninstalling erases all stored data for that store.
- CartBloom implements Shopify's mandatory privacy webhooks:
  `customers/data_request`, `customers/redact` and `shop/redact`. The two
  customer topics are acknowledged with nothing to return, because no customer
  data is ever held; `shop/redact` erases every record for the store.

**Also cover:** the merchant's rights (access, export, deletion), GDPR/CCPA
posture, contact route for privacy questions, and how policy changes are
communicated.

---

### Hard constraints — do not violate these

The site is linked from a Shopify App Store listing and will be reviewed.

1. **Invent no statistics.** No "increases AOV by 30%", no "trusted by 500
   stores", no conversion percentages. CartBloom is newly launched and has no
   such data. Any number on this site must be a plan limit or a price.
2. **Invent no testimonials, reviews, ratings, star counts or customer logos.**
   Leave those sections out entirely rather than filling them with placeholders.
3. **Do not imply affiliation with or endorsement by Shopify.** Do not use the
   Shopify logo, the word "Shopify" in the site name or logo, or Shopify's brand
   colours as the primary palette. "Built for Shopify" as a plain descriptor is
   fine; a badge implying certification is not.
4. **No countdown timers, fake urgency, or "limited spots".**
5. **Every claim must be one of the capabilities listed above.** If a section
   needs filler, cut the section.
6. Use `support@cartbloom.space` as the placeholder support address and mark it
   clearly so it can be swapped.
7. Leave the App Store install URL as a clearly-marked constant at the top of the
   config — the listing is not published yet.

### Deliverables

- Complete Next.js project, typechecking clean, ready to deploy to Vercel or
  Cloudflare Pages.
- Content in a typed config file, separate from components, so copy can be edited
  without touching JSX.
- A reusable `<Motion>` wrapper that centralises the reduced-motion check.
- `README.md` covering local dev, deployment, and where to change copy, pricing
  and the install URL.

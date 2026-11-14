# Blog and publishing system · spec

The site gets a blog called **Signaal** ("Signaal, de blog van Flow State"). A scheduled cloud agent writes a new post every three days and publishes it without human review. This spec covers everything that makes that work: content format, build script, templates, SEO output, validation, deployment, and the two agent roles. Read `docs/BRIEF.md` (brand, tokens, honesty rules) and `docs/COPY.md` (voice) first.

## Hosting and URLs

* The repository root is the project root. GitHub Pages deploys ONLY the `site/` folder through a GitHub Actions workflow (no Jekyll, no branch deploy).
* Production URL: `https://flowstateconsultancy.nl` (apex). Keep it in one config constant (`tools/site.config.json`, key `siteUrl`).
* The whole site will switch to **root-absolute URLs** (`/assets/css/base.css`, `/diensten.html`). Blog pages live in a subfolder, so the blog templates and build output must use root-absolute URLs from day one. The orchestrator converts the static pages later; do not touch them.
* Blog URLs: index `/blog/` (file `site/blog/index.html`), posts `/blog/<slug>.html` (files `site/blog/<slug>.html`). Canonicals use exactly these forms.

## Content format

One folder per post: `content/blog/<slug>/` with two files:

* `meta.json`:

```json
{
  "title": "H1 of the post, max 70 characters",
  "seoTitle": "Title tag without the brand suffix, max 47 characters (47 + ' | Flow State' = 60)",
  "description": "Meta description, 120 to 155 characters, Dutch, no dashes",
  "slug": "kebab-case-dutch-slug",
  "date": "2026-11-14",
  "updated": "2026-11-14",
  "category": "Sales",
  "primaryKeyword": "salestraining telecom",
  "keywords": ["salestraining", "telecom"],
  "sources": [{ "title": "Article title", "publisher": "ACM", "url": "https://...", "date": "2026-11-10" }],
  "faq": [{ "q": "Question?", "a": "Answer in one to three sentences." }],
  "internalLinks": ["/diensten.html#training"]
}
```

* `post.md`: Markdown body. No H1 (the template renders the title). Starts with an intro paragraph. Sections use `##` and `###`. Internal links are root-absolute (`/diensten.html#coaching`). External links are full URLs.
* Categories (fixed list): Sales, Telecom, Coaching, Teamleiders, Retentie, Markt.
* Do not use YAML front matter (the writing hook rejects list dashes); JSON only.

## Build script (`tools/build.mjs`, run with `npm run build`)

Dependency: `marked` only (root `package.json`, `"type": "module"`). Node 20+. Deterministic output (same input, same files).

1. Read `tools/site.config.json` (siteUrl, site name, organisation details incl. kvk, btwId, address, email, logo path, default OG image, static pages list with path and title for the sitemap).
2. Read all posts, validate meta (required fields, lengths, slug format, date format, category in list, url formats) and fail with a clear message on any error.
3. Render each post to `site/blog/<slug>.html` from `tools/templates/post.html`.
4. Render `site/blog/index.html` from `tools/templates/blog-index.html` (newest first; the newest post featured large).
5. Inject the latest three posts into `site/index.html` between the markers `<!-- blog:latest:start -->` and `<!-- blog:latest:end -->` (if the markers exist; markup uses classes from blog.css). Never touch anything else in static pages.
6. Write `site/sitemap.xml` (static pages from config plus blog index plus posts; `lastmod` from `git log -1 --format=%cI -- <file>` with file mtime as fallback; posts use `updated`), `site/feed.xml` (RSS 2.0, latest 20 posts, full absolute URLs, `atom:link rel=self`), and keep `site/robots.txt` with a `Sitemap:` line.
7. Header and footer come from `site/_template.html` at build time (extract the `<header class="site-header"` and `<footer class="site-footer"` blocks), so navigation changes propagate to the blog automatically. On the blog pages mark the Blog nav item with `aria-current="page"` when it exists.
8. Reading time: words / 220, rounded up, minimum 2.

## Templates (`tools/templates/`)

Same head structure as `_template.html` (fonts, tokens, base, plus `/assets/css/blog.css`; vendor scripts; module `/assets/js/blog.js` that imports `/assets/js/core.js`). Root-absolute URLs everywhere. Paper background, `body data-header="on-paper"`.

* `post.html`: breadcrumb (Home / Blog / title) in mono xs; category label; H1 in `.display` (not display-xl, posts have long titles); meta row with date (Dutch format, e.g. 14 november 2026), reading time and "Flow State Consultancy" as author (organisation, never an invented person); no repeated description (the first body paragraph is the lead; the meta description is for search results only); on desktop a sticky table of contents built from the h2s; body in `.prose` with good long-form typography (h2, h3, lists, blockquote, links, tables, code not needed); a "Bronnen" list with the sources (publisher, title, date, link); the FAQ as `.faq` details if present; the shared `.cta-band` with the copy from COPY.md; "Lees ook" with up to three other posts.
* `blog-index.html`: mono label Blog; H1 `Signaal.` with a lead "Artikelen over verkopen, coachen en telecom, van Flow State Consultancy."; featured newest post; then a list or grid of the rest with date, category, title, description and reading time; an RSS link.
* `site/assets/css/blog.css` and `site/assets/js/blog.js` (TOC active-state highlight, reveal hooks via core.js). Tokens only, no raw hex.

## SEO output per blog page

* `<title>`: `{seoTitle} | Flow State` (max 60 characters total), meta description, `<link rel="canonical">` absolute, `meta robots index,follow,max-image-preview:large`, Open Graph (type article on posts, absolute og:url and og:image using the default image `/assets/img/og-image.png`, og:locale nl_NL, article:published_time, article:modified_time), Twitter card summary_large_image, RSS alternate link.
* JSON-LD (one `<script type="application/ld+json">` with an `@graph`): `BlogPosting` (headline, description, datePublished, dateModified, inLanguage nl-NL, author and publisher as the Organization with logo, mainEntityOfPage, image, keywords, articleSection) and `BreadcrumbList`; add `FAQPage` only when the post has faq entries. Blog index: `Blog` plus `BreadcrumbList`. The organisation node (type `ProfessionalService`, from `tools/site.config.json`) uses `@id` `https://flowstateconsultancy.nl/#organization` and is identical on every page, because `dev/seo-heads.mjs` and the blog build both use `organizationNode()` from `tools/lib/render.mjs`.

## Validation (`tools/check.mjs`, run with `npm run check`; unit tests with `npm test`)

Fails (exit 1) on: missing or over-long title/description, missing canonical, not exactly one h1, broken internal links or anchors, invalid JSON-LD (must parse), sitemap or feed not well-formed XML, missing alt on img, em or en dashes in visible text of generated pages, posts with fewer than 700 or more than 2200 words, posts with no internal link to a service page, posts with an external source that is not https. Also runs `python3 tools/check_copy.py --lang nl` on every `post.md` (vendor the checker from `~/.claude/skills/menselijke-nl-copy/scripts/check_copy.py`).

## Deployment (`.github/workflows/deploy.yml`)

On push to `main` and `workflow_dispatch` (blog branches `claude/blog-<slug>` are first validated and merged into `main` by `.github/workflows/blog-publish.yml`, which then starts this deploy): checkout with full history, setup Node (LTS), `npm ci`, `npm run build`, `npm run check`, remove development-only files from the artifact (`site/_*`), upload `site/` as the Pages artifact, deploy with the official Pages actions. Then an IndexNow step: submit the URLs of posts and pages changed in the pushed commits to `https://api.indexnow.org/indexnow` with the key file `site/<key>.txt` (generate a random 32 hex key once, commit the key file). Use current major versions of the official actions (check them). Concurrency group `pages`, no cancel in progress.

## The two agent roles (`.claude/agents/`)

* `seo-strateeg.md`: Dutch SEO strategist for Flow State. Before writing: researches what is current (news and discussions of the last 14 days in Dutch telecom and sales, rule changes, market moves, practical sales topics), checks existing posts in `content/blog/` to avoid overlap and keyword cannibalisation, picks one topic with clear search intent and business relevance (telecom sales, sales coaching, sales training, retention, team leadership), and returns a brief: primary and secondary keywords, intent, title, seoTitle, description, slug, H2/H3 outline, the internal links to use, two to four FAQ questions, and three or more reliable sources (official bodies, reputable Dutch media, original research). After writing: reviews the draft against an SEO checklist (keyword in title, first 100 words, one H2 and the meta description; descriptive headings; internal links; readability; length; no stuffing) and returns concrete edits.
* `blog-schrijver.md`: Dutch writer in Flow State's voice (see COPY.md): direct, concrete, `je`, practical sales advice someone can use tomorrow. Writes `post.md` and `meta.json` from the brief. Hard rules: never invent numbers, studies, quotes, clients, cases or experiences; every number or factual claim about the market has a source in `sources` and a link in the text; no dashes as punctuation; no hollow marketing words; sentence-case headings; 900 to 1500 words; at least two internal links to service pages; ends with a short practical takeaway, not a sales pitch.

## Routine instructions (`automation/ROUTINE.md`)

A self-contained instruction file for the scheduled cloud agent, in English, executed every three days:

1. Read `automation/ROUTINE.md`, `docs/BRIEF.md` section 0, `docs/COPY.md` (voice), `docs/BLOG-SPEC.md`.
2. Ask the `seo-strateeg` subagent for a brief.
3. Ask the `blog-schrijver` subagent to write the post into `content/blog/<slug>/`.
4. Ask `seo-strateeg` to review; have `blog-schrijver` apply the edits.
5. Run `npm ci`, `npm run build`, `npm run check`; fix until green (never weaken the checks).
6. Append a line to `automation/log.md` (date, slug, primary keyword, sources count).
7. Commit with message `Blog: <title>` and push to `main`. If pushing to main is not allowed in this environment, push a branch, open a pull request and merge it.
8. If anything is uncertain about facts, choose a safer evergreen topic instead of guessing. If no post can be published safely, publish nothing and record why in the log.

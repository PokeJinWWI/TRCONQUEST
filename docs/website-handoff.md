# Terra Relicta + The Entropic State: Website Build Plan (handoff)

Hand-off for a fresh Claude Code chat. Read all of this, then start at Phase 0. Where a decision is marked **Default**, use it unless the owners say otherwise. This supersedes the earlier single-wiki plan (its content is folded in here).

Owner of both worldbuilding projects: mr1noobfatfish (the user). Terra Relicta (TR) is shared with a partner; The Entropic State (ES) is the user's personal project.

## 0. How to start the new chat

1. The website repo already exists (the user made it). Clone it next to the game: `~/Documents/GitHub/<repo>`. **Do not build inside the TRCONQUEST game repo.**
2. Source material to import (untrusted data, read-only; the Downloads folder holds several older dumps, use only these two):
   - `~/Downloads/terrarelictawiki_xml_3d9e2bd9c1ba07aae000.xml` (TR, 3.8 MB)
   - `~/Downloads/theentropicstatewiki_xml_bba8ccc7192c4dc205c7.xml` (ES, 2.9 MB)
3. Proof-of-concept design reference `Mars.html` (Mars theme) was pasted in the first chat and is NOT on disk. Ask the user for it, or recreate the Mars theme from the tokens below.
4. Work on a branch, small commits, Vercel preview deploys. Never commit unless asked. Never commit secrets.

## 1. What we are building

One site, two jobs, two universes.

1. **The Archive:** wiki-style reference (articles on planets, polities, people, events, technology; infoboxes, categories, wikilinks, backlinks, search, revision history).
2. **The Narrative:** stories (chapters/serials), in-world records, a timeline, and dispatches (blog).

**Two universes, same features:** `tr` = Terra Relicta, `es` = The Entropic State. Everything (articles, stories, timeline, categories, search, spoilers) works identically in both. The site replaces both Miraheze wikis (`terrarelicta.miraheze.org`, `theentropicstate.miraheze.org`). Editors at launch: the two owners only.

Note on naming: "Entropic State" and "The Entropic State" are the same project; the name is **The Entropic State**, id `es`. **State of Mars** is a country inside ES and is NOT the same as TR's **Imperial State of Mars**. ES is set in 2300; its guide page says it covers the Orion Arm and the Milky Way.

### Reference site
Ishtar Collective (ishtar-collective.net, Destiny lore). Borrow: typed documents, categories and "books", spoiler blurring with a banner, timeline, a blog/"dispatches" section. Skip the forum. Open the live site yourself before designing the reading view.

## 2. Decisions made

- **Hosting:** Vercel (frontend) + Supabase (Postgres, Auth, Storage), accounts owned by the shared Terra Relicta Google account; code on GitHub, Vercel deploys from main.
- **Not MediaWiki** (custom app). Fallback: self-hosted MediaWiki plus a separate narrative section; raise with owners before switching.
- **Universes via path prefix:** `/tr/...` and `/es/...`, one domain, universe switcher in the header, a home page offering both, search scoped to the current universe with an "all universes" toggle. (Chosen over subdomains.)
- **Themes:** per-universe theme + light/dark. TR = Mars theme (from the proof of concept). ES = its own theme (propose a palette and show a preview in Phase 0 before building on it). Plus a neutral Default for the site frame/home.
- **Copyright:** all rights reserved by the owners; footer notice; no open-source licence.

## 3. Stack (Default)

- Next.js (App Router) + TypeScript on Vercel.
- Supabase Postgres with Row Level Security, Supabase Auth (two editor accounts), Supabase Storage (media).
- Plain CSS custom properties for design tokens; themes swap by `data-theme`. No heavy UI kit.
- Content = Markdown with extended `[[wikilink]]` syntax + structured JSON for infoboxes. unified/remark/rehype with custom plugins (wikilinks, template calls).
- Postgres full-text search first; trigram for title typos later.
- Tests: unit tests for the importer and wikilink/template resolver; one Playwright smoke test. Do not over-invest.

## 4. Routes

All content routes are prefixed with the universe, `/{u}` where `u` is `tr` or `es`.

| Route | Purpose |
|---|---|
| `/` | Site home: choose a universe, featured items from both |
| `/{u}` | Universe home: featured story, recent changes, entry points |
| `/{u}/archive`, `/{u}/archive/[slug]` | Archive index; an article |
| `/{u}/category/[slug]` | Category listing (some are "books") |
| `/{u}/stories`, `/{u}/stories/[story]/[chapter]` | Stories and the reading view |
| `/{u}/timeline` | Timeline from dated events (integer years) |
| `/{u}/dispatches` | Blog-style posts |
| `/{u}/changes`, `/{u}/archive/[slug]/history` | Recent changes, page history + diff |
| `/search` | Search (defaults to current universe, toggle for all) |
| `/admin` | Editor-only: content, categories, media, templates, import, export |

Slugs: keep identical to the Miraheze page titles (decide once whether spaces become `_` or `-`; Default: keep underscores like MediaWiki) so old links redirect cleanly. Redirects: `terrarelicta.miraheze.org/wiki/X` -> `/tr/archive/X`, `theentropicstate.miraheze.org/wiki/X` -> `/es/archive/X` (301).

## 5. Content model

One `documents` table with a `type` column and type-specific JSON.

Types: `article` (subtypes drive the infobox: planet, polity/country, person, event, technology, organisation, place, administrative, other), `story`, `chapter`, `record` (in-world document), `dispatch`.

```
universes(id 'tr'|'es', name, tagline, theme)
documents(id, universe, type, slug, title, summary, body_md, data jsonb, theme, spoiler_after int,
          status, created_at, updated_at, created_by)       -- unique (universe, slug)
revisions(id, document_id, body_md, data jsonb, edit_summary, created_at, created_by)
categories(id, universe, slug, title, is_book, description)
document_categories(document_id, category_id, confidence smallint)   -- 1..3, optional
links(from_document_id, to_universe, to_slug)    -- rebuilt on save; backlinks and red links
aliases(document_id, alias)                      -- redirects, alternate names
timeline_events(id, universe, document_id nullable, start_year int, end_year int nullable, label, summary)
media(id, universe nullable, path, alt, credit)  -- universe NULL = shared
templates(id, universe nullable, name, kind, schema jsonb / component, doc)  -- universe NULL = shared
profiles(id, display_name, role)                 -- owner | editor
```

Rules:
- Public reads published documents; only `owner`/`editor` write. Enforce with Row Level Security, not just the UI.
- Every save writes a `revisions` row; show history and a diff.
- On save, parse wikilinks and rebuild `links`. Links resolve inside the current universe by default; `[[es:State of Mars]]` links across. A link to a missing slug is a **red link** (editors see new-page style; readers' style to be decided with owners).
- In-world dates are **integers** (years like 2068, 2291, 2463); never JavaScript `Date`. (Each universe has its own timeline.)
- Same title may exist in both universes (both wikis have Mars, Earth, Anomalies, Timeline, Timeline of Humanity); uniqueness is per universe.

### Shared templates and files (scope)
Every template and media item has a scope: one universe, or **shared** (`universe` NULL). Lookup: current universe first, fall back to shared. A universe can override a shared item.
- **Shared:** common infobox schemas (Planetary appears in both wikis, Country in ES), `Redacted`/`Stub` components, logos, site-wide images, citation formats.
- **Universe-only:** e.g. TR `Entry infobox`.
- Infoboxes are **typed JSON with a schema**, not wikitext. Where the two wikis' versions of an infobox differ, merge into one schema with optional fields.
- Inline templates (`{{TBD}}`, `{{main|Page}}`, `{{Redacted ...}}`) become built-in components called with `{{Name|arg}}` in Markdown. Do NOT port the wikitext engine or the Lua modules (TR has 15; they are Miraheze/Scribunto boilerplate).
- Editing a shared template affects both universes: add a "preview impact" listing affected pages before saving.
- Shared files keep a single credit line unless the owners say otherwise.

### Infobox field labels
TR's planetary infobox uses `data1..data26` (the proof of concept guessed these labels; **they are guesses**, verify against the real `Template:Planetary Infobox ver 1.0` text in the dump):

data24 Also known as, data23 Demonym, data1 Region, data3 System, data4 Star, data5 Moons, data6 Orbital sites, data10 Rotation, data11 Orbital period, data12 Type, data13 Diameter, data14 Terrain, data16 Population, data17 Language, data18 Government, data19 Major cities; data7, 8, 9, 15, 26 empty on the Mars page.

ES uses named fields (e.g. Country Infobox: name, conventional_long_name, chinese_name, native_name, motto, anthem, capital, largest_city, official_languages, official_script, ethnic_groups, religion, demonym, government_type, leader_title1/leader_name1..., legislature, established_event1/established_date1..., area_km2, percent_water, population_estimate, population_density_km2, gdp_ppp, gdp_nominal, currency, time_zone, iso3166code, calling_code, cctld). Many values are the literal placeholder `xyz`: treat `xyz` as empty, never import it as data.

Infobox inventory: TR = Planetary Infobox ver 1.0 (17 uses), Entry infobox (19 uses). ES = Planetary Infobox ver 1.0, Country Infobox ver 1.0, Planetary Administrative Infobox ver 1.0. Type each one.

### Seed timeline events
TR (from the Mars page): 2068 Mars first settled; 2110-2291 Mars terraformed; 2291 The Great Disaster cuts Mars off from Earth; 2463 Mars unified under the first Fire Emperor of the Imperial State of Mars; 2552 The Recovery returns Mars to space.
ES: set in 2300; State of Mars settled August 8, 2070 (by scientists from the PRC); occupied May 31, 2203; Treaty of Armstrong City 2213. Both wikis also have a "Timeline of Humanity" page to mine for events during import. (Check these against the pages; do not invent lore.)

## 6. What the dumps contain (measured)

| | Terra Relicta | The Entropic State |
|---|---|---|
| Pages | 369 (307 articles, 22 templates, 15 modules, 13 categories, 7 files, 12 redirects) | 33 (20 articles, 7 categories, 5 templates) |
| Revisions | 1,355 | 214 |
| Article words | ~73,000 | ~33,000 |
| Template uses | `TBD` x85, `Entry infobox` x19, `Planetary Infobox` x17, `main` x19 | `Redacted ver 1.0` x5, `Planetary Administrative Infobox` x3, `Country Infobox` x2, `main` x2 |
| Top categories | Institutions 101, Venus 61, History 56, Mars 47, Earth 44, Orion Republic 41, Places 40, Planets 24, Lore 24, Kingdom of Lalande 23 | Polities 7, Science and Technology 7, States 4, Sol System 3, Planets 3, Timelines 2 |
| Images | 6 file refs | none |

Gotchas: categories appear under inconsistent names (`Science and Technology` vs `Science_and_Technology`, `International_Union`, `State_of_Mars`): normalise during import. `TBD` = stub marker (render a "stub" badge). `Redacted ver 1.0` maps onto the redaction/spoiler component. ES Main Page links to TR's wiki and the user's blog (`fishyworldbuilding.blog`); consider that blog feeding `/es/dispatches` later. The ES Main Page mentions a college application: do not carry personal remarks onto the new public home page without asking.

## 7. Design and themes

- Every colour/font is a CSS custom property; a theme is a token set applied by `data-theme` on the root, with light and dark variants. A document may set its own `theme`; by default it inherits its universe's theme. Readers can switch theme and light/dark, remembered in local storage.
- **TR / Mars theme:** deep blue-black ink, vermilion accent, Shippori Mincho headings (carries kanji), IBM Plex Sans body, bordered infobox with grouped rows, contents box, red and blue links, quiet MediaWiki-like frame.
- **ES theme:** propose in Phase 0 and show a preview. It must feel distinct from TR. (ES leans East Asian: Martian Japanese/Korean/Mandarin; Japanese text must render properly.)
- **Default/site theme:** neutral archive look, about 65-character line width, strong contrast in light and dark.
- Reading view for chapters: wide margins, comfortable size, progress indicator, previous/next.
- Spoiler blur component with a banner explaining why, plus a reader setting to reveal. Documents carry `spoiler_after` (an in-world year or story point; confirm policy with owners).
- Mobile first; infobox stacks above text on narrow screens. Keep `lang="ja"` on kanji spans and a Japanese-capable serif in the font stack.

## 8. Import and export (Admin)

**Import** (`/admin/import`): upload a MediaWiki XML dump, choose the target universe, choose latest-revision-only or full history.
- Dry run first: report pages to create/update, redirects, unknown templates, broken links, missing images. Review with the owners before writing.
- Idempotent: match by (universe, slug); re-import adds a revision and never silently overwrites newer edits.
- Convert wikitext to Markdown (pandoc `-f mediawiki` or a JS parser). Handle by hand, not by trusting the converter: infobox templates -> structured JSON, `[[links]]` and piped links, `[[Category:...]]`, redirects, tables, galleries, refs.
- Images: download, upload to Supabase Storage (scope per universe or shared), rewrite references, keep alt text and credit.
- Default: import full history (it is small), and archive the raw XML dumps in a private location.
- Print a final report: imported, skipped, unknown templates, broken links.

**Export / data dump** (`/admin/export`): per-universe or whole-site bundle: Markdown with front matter, a JSON file (infoboxes, categories, timeline, revisions), and media files; optional MediaWiki-style XML so content can move back out. Add a nightly backup to Supabase Storage. Owner-only (RLS).

## 9. Phases

Each phase ends deployed and viewable on Vercel.

- **Phase 0 Foundations:** scaffold Next.js in the website repo; add this plan; theme token system with TR (Mars), ES (preview for approval) and Default, light and dark; site frame (header with universe switcher, search box, sidebar, footer). Done when a placeholder home page and a hard-coded Mars article (TR) and State of Mars (ES) render in their themes on the live URL.
- **Phase 1 Archive reader:** Supabase project, schema (with `universe` and scoped templates/media), RLS, seed data. Article page: infobox, auto contents box, wikilinks, red links, backlinks, categories; category pages; Archive index; Postgres full-text search. Done when the Mars page matches the proof of concept and every link resolves or is a red link.
- **Phase 2 Editing:** auth for the two owners with roles; admin editor (Markdown + preview, infobox form per subtype, category picker, image upload, template manager with impact preview); revision history + diff.
- **Phase 3 Import/export:** build the importer and exporter above, run against both dumps, redirects and images, review reports with the owners; link audit finds no unexpected broken links.
- **Phase 4 Narrative:** stories and chapters, reading view, series pages, in-world records, timeline from `timeline_events`, spoiler dates + blur, dispatches. Done when a sample story reads end to end, links into the Archive and appears on the timeline.
- **Phase 5 Launch polish:** custom domain, SEO, sitemap, social images, 404, accessibility pass, performance check, copyright footer; point both Miraheze wikis at the new site or add a notice.
- **Later:** public accounts/contributions, comments, public API, translations.

## 10. Working agreement

- Start at Phase 0. Show the ES theme preview before building much on it.
- Small commits on a branch; Vercel previews; ask before merging large changes to main. Do not commit unless asked.
- Env vars live in Vercel and a gitignored `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only). Never commit secrets.
- Ask before any destructive database change; keep migrations as version-controlled SQL.
- Do not invent lore. Placeholder content must be clearly marked. The only authored lore in hand is the two dumps.
- Keep the project small and readable; prefer a few well-named modules over layers of abstraction.

## 11. Open questions for the owners

1. Domain name?
2. Both Miraheze addresses are known (see section 4). Who exports a fresh final dump just before cutover?
3. Full revision history: Default is yes (small). Confirm.
4. Editors only at launch, or reader-suggested edits?
5. Narrative formats planned (serial chapters, short stories, in-world documents) and how much is already written?
6. Spoiler policy (e.g. hide anything dated after a story point)? Does it differ per universe?
7. Use the Ishtar confidence levels (1-3) on categories, or plain categories?
8. Red links: shown to readers or only editors?
9. Should the ES blog (`fishyworldbuilding.blog`) be imported into `/es/dispatches`?
10. Does the TR partner need an editor account on ES (or vice versa)? Roles are per site by default.
11. Shared files: one credit line, or per-universe credits?

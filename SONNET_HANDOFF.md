# Handoff: NERV theme, bilingual labels, Situations (for the next model)

Read `CLAUDE.md` first (the "Situations, notifications, side panels, UI themes" bullet near the end explains the whole system), then the plan at `~/.claude/plans/dapper-puzzling-lemon.md`. Nothing is committed: do NOT commit unless the user asks.

## Ground rules
- Run tests ONE AT A TIME (`npx tsx tests/<name>.test.ts`), never in parallel, and use `nice -n 19` for long runs: parallel runs lagged the user's machine badly.
- After any change: `npx tsc -b`, the relevant tests, and before finishing all tests serially + `npm run build`.
- `tests/acceptance.test.ts` already fails on the last commit ("Earth#infrastructure-0: over capacity"). Not ours; don't chase it unless asked.
- Default theme must stay exactly as it was. All NERV CSS goes under `html[data-theme='nerv']` (tests/themes.test.ts checks it).
- Translations live in data files, never hand-edit the generated ones:
  - short labels: `scripts/i18n/terms.tsv` (English TAB Japanese TAB Traditional TAB Simplified) -> `npx tsx scripts/i18n/buildDicts.ts`
  - long descriptions: `scripts/i18n/desc/NN-*.json` (`[{en, ja, zhHant, zhHans}]`) -> `npx tsx scripts/i18n/buildDescriptions.ts`
  - Simplified Chinese must contain no traditional-only characters (tested).

## How it works (short)
- `state/themeStore.ts`: Default | NERV, script ja / zh-Hant / zh-Hans, reduce motion (localStorage).
- `components/Bi.tsx`: `<Bi en="..."/>` = English + native span (NERV only). `useNativeText()` for SVG.
- `components/NativeAnnotator.tsx`: in NERV, adds `data-native` (short labels, drawn by CSS `::after`) and `data-native-desc` (whole translated paragraphs, drawn as a block under) to DOM elements; Alt-click any label to type its native text (stored as `placeNameStore` key `label:<English>`). Dev builds collect untranslated labels in `window.__nativeMisses`.
- `i18n/native.ts` `nativeOf` (dictionary + composer rules), `i18n/descriptionLookup.ts` (description table, lazy-loaded), `components/TooltipLayer.tsx` (`NativeTipText` adds translations to tooltips).
- Renamable things: `components/NativeName.tsx` (`NamedBi`, `NativeNameInput`, `RenameField`), subscripts per script in `placeNameStore.natives[key][script]`.

## Open bugs (from the user's latest screenshots) — do these first
1. **A paragraph with a `<Bi>` inside it gets no translation.** Example: "Each card is a place on Venus. Press + Build here on any of yours: the district it needs is developed for you. Room for 10 more district levels on this world." The codemod wrapped "Build here" in `<Bi>`, so (a) a native label appears mid-sentence ("Build here 在此建造") and (b) the paragraph's textContent no longer matches the description table. Fix: inside prose, don't use `<Bi>` (unwrap it back to plain text in that component, and check other prose for the same pattern: grep for `<Bi en=` inside `ship-panel-hint`, `abs-dim` paragraphs etc.); make `annotateDescription` ignore `.native` children when reading text (use the text without `.native` spans) so it still matches. The text also has a dynamic part ("Venus", "10"): exact-match descriptions can't cover it. Add a template mechanism: description keys with placeholders like `{0}` matched by regex (e.g. build a regex per template entry, numbers/names captured and re-inserted in the translation), then add this sentence as a template.
2. **Chart month ticks overlap.** In `components/TimeChart.tsx` the native month is appended to the tick label ("Jun 00 6月", "Jul 7月"), so neighbouring ticks collide ("Nov 11月ec 12月"). Fix: put the native month on a second line under the English tick (`<tspan x=... dy="1.1em">`), and give the chart a little more bottom padding in NERV (or drop every other native label when ticks are dense). Also the chart title "GDP (per year)" has no native label: titles come from props; wrap the chart title in `<Bi>` in TimeChart's header (and make sure "GDP (per year)" resolves: add it to terms.tsv if the composer doesn't).
3. **Descriptions still missing.** Batches done: techs, resources, starbase modules, landmarks, Simple buildings, Complex recipes, glossary (382 entries). NOT done: the ~218 static help texts in components (extracted list: run the regex in step 4) and every dynamic text built with template literals (needs the template mechanism from bug 1).

## Remaining work, in order
4. Translate the component help texts. Extract them with:
   `python3` over `src/**/*.tsx`: JSX text nodes of 40+ chars starting with a capital and containing `.` `,` or `—`, plus `title="..."` attributes of 40+ chars. Write `scripts/i18n/desc/05-ui-prose.json` (and 06 for the rest). Skip junk matches (code fragments like `DEPLETABLE_GOODS.includes(...)`).
5. Templates for dynamic descriptions/tooltips (see bug 1), then translate the most common ones (tooltips in ShipPanel, planet tabs, Situations line texts in `scene/situations.ts` — those are template strings too).
6. Re-run the Complex and Simple "walk every panel" check in the browser (pick a nation, open every nav category/subtab/planet tab, read `window.__nativeMisses`), add the misses to terms.tsv.
7. Full serial test run + `npm run build`. Note the fonts add ~30 MB to the build (CJK woff2 slices; only the used slices download at runtime).

## Things the user decided (don't re-ask)
- Fonts: Oswald / Barlow Condensed / Fira Code; kanji Noto Serif JP/TC/SC Black (big text) + Noto Sans JP/TC/SC Black (labels) + Noto Sans 400 (description paragraphs).
- Map lines in NERV are mint green (orbits, lanes, grids); frames/labels orange. Tone mapping is off for those lines in NERV only (`scene/themeColors.ts` `toneMapped`).
- Native date is vertical beside the English date, digits upright.
- Descriptions: full translation shown under each English paragraph.
- Top bar wraps to more rows instead of overlapping (`.hud-top > .hud-center-swap { flex: 1 0 auto }`).
- Hyperium deposits existing in Complex mode is by design (both modes extract); the user asked "why" — if they want it gone from Complex, gate the planet-panel row and `applyExtraction` on mode, but only if asked.
- Fleets and ships can be renamed (✎ in Fleet Manager, ship panel Name and Fleet rows), each with a per-script subscript.

## Verify in the browser
Dev server: `.claude/launch.json` "trc-dev" (it lands on port 5174 when 5173 is taken). Pick a nation on the main menu, Settings/main menu "UI Theme: NERV". The browser pane throttles rendering when hidden: verify via DOM attributes (`data-native`, `data-native-desc`, `.game-tooltip-native`) rather than trusting stale screenshots.

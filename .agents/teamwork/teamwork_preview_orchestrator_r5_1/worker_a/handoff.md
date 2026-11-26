# Handoff — Frontend Wave A (items 1-9, 11, 13, 18, 23)

## Observation
- Commands run in frontend/: `npx tsc --noEmit` -> clean; `npm test` -> pass 10 / fail 0; `npm run build` -> built OK. Backend untouched (profile router already has GET/PUT /profile/sidebar-order and PATCH /profile/preferences sanitizing sidebar_order) so no pytest.
- `biome check src` reports 209 pre-existing errors (not introduced here, not addressed).
- Found/fixed a real type error: setup/index.tsx used `status.gemini_model` (should be `status.gemini.model`).

## Logic Chain (changes)
1 login: username/email/displayName defaults now empty (auth/v2/login/route.tsx).
2 login right panel: decorative CSS terminal preview (no invented quotes) in auth/v2/route.tsx.
3 palette: new `bank` preset (bank.css, theme.ts, styles.css import), default preset+dark navy/royal blue.
4 hotkeys: 2 equal columns grid.
5 sidebar: nav-main.tsx uses longest-prefix match so view/edit/new keep item active.
6 fonts: IBM Plex Sans/Mono added to registry, default ibmPlexSans; --font-mono; body tabular-nums.
7/8 ticker: slow=120s (normal 60, fast 30); clock removed.
9 menu reorder: applySidebarOrder in sidebar-items.ts, AppSidebar uses store sidebarOrder; Preferences gets drag+up/down reorder card; persisted via existing queueServerPreferenceSync (PATCH sidebar_order) + hydrated from server. i18n key sidebarOrder (ru/en/az).
11 ID first column linking to detail view: accounts, users, treasury, login-history, audit, calendar, robots, profiles, news sources; journal ticket linked.
13 audit detail: wide 3-col layout, localized action label, actor username, key/value details + JSON.
18 2FA QR: svg now sized to container (aspect-square, svg size-full).
23 combobox: new ui/search-select.tsx (custom popover, search, keyboard nav; drop-in for <option> children + onChange) + lib/select-options.ts; every `<select>` replaced; native-select.tsx now wraps it. Tests added in m5-core.test.ts (filterOptions, moveHighlight).

## Caveats
Not visually verified in a browser. Containers/hubs/wiki/sessions/ai are card/list UIs without table, so no ID column added there. Biome lint backlog untouched. Combobox width uses `--anchor-width` from base-ui popover.

## Conclusion
Wave A implemented; tsc/test/build green.

## Verification Method
cd frontend && npx tsc --noEmit && npm test && npm run build; grep -rn '<select' src (only comments).

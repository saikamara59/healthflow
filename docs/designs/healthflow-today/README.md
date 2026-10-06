# HealthFlow Today — Claude Design reference

Source design for the Today page and the workspace shell (sidebar, top bar, quick-action strip),
exported from Claude Design ("HealthFlow Today.html"). All names and records in it are fictional.

- `today-desktop.png`, `today-mobile.png` — the design rendered at 1440px and 390px.
- `src/today-app.jsx` — Today page, sidebar, top bar, and icon tiles (the main reference).
- `src/design.css` — the design's stylesheets, combined (base, Today, soft theme, Figtree overrides).
- `src/*.jsx` — prototype pages not built yet: approvals, team admin, connectors, documents, follow-ups.

The prototype runs React from a CDN with in-browser Babel and globals on `window`; it is a
visual reference, not code to import. The app implementation lives in:

- `frontend/src/shell.css` — theme tokens (moss + Figtree), icon tiles, sidebar, top bar, quick-action strip.
- `frontend/src/today-v2.css` — Today page layout.
- `frontend/src/components/ui/HfTile.jsx` — colored duotone icon tiles (Phosphor icons).
- `frontend/src/components/Sidebar.jsx`, `frontend/src/components/TopBar.jsx`, `frontend/src/pages/TodayPage.jsx`.

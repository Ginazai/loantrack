# ADR-007: Adopt IBM Carbon Design System for the frontend

**Status:** Accepted
**Date:** 2026-10-22
**Supersedes:** the *Styling* line of ADR-001 (Tailwind CSS + DaisyUI)

## Context
The UI was built on Tailwind + DaisyUI with a custom "ledger" theme, AG Grid for
the accounts table, and lucide icons. It worked, but it read as a prototype:
three visual languages (DaisyUI, AG Grid's theme, Recharts defaults), hand-rolled
modals/tabs/toggles, `window.alert()`/`confirm()` for validation and deletes, and
dark mode implemented as a second hand-tuned palette. The goal was a more
professional, high-end look.

## Decision
Use **IBM Carbon (v11)** via `@carbon/react`, with real Carbon components
(UI Shell, DataTable, Tile/Tag, Modal, Tabs, forms, notifications), the
**IBM Plex** typefaces (self-hosted via `@fontsource`), and `@carbon/icons-react`.

- **Themes:** Carbon `white` (light) and `g100` (dark), applied as `cds--white` /
  `cds--g100` on `<html>` (see `uiStore.applyTheme`). The header is always in the
  `g100` zone. Previously persisted values (`ledger`, `ledger_dark`) are migrated.
- **Styling:** one SCSS entry (`src/styles/index.scss`) that uses Carbon tokens
  only: theme colors, the spacing scale and type styles. No hard-coded colors, so
  both themes work without overrides. Tailwind, DaisyUI, PostCSS and autoprefixer
  were removed.
- **Table:** AG Grid is replaced by Carbon `DataTable` (sortable on raw values,
  paginated). Charts stay on Recharts, restyled with Carbon tokens.
- **Side panel:** Carbon core has no side panel (it lives in `@carbon/ibm-products`,
  a heavy dependency). `Drawer` stays an in-house component built on Carbon tokens,
  now with a focus trap and focus restore. Yes/no decisions use Carbon `Modal`.
- **Feedback:** `alert()`/`confirm()` replaced by inline Carbon notifications and
  `ConfirmDialog`.

## Consequences
- Consistent, accessible-by-default UI; axe-core (WCAG 2.1 AA) reports no
  violations across the main views in both themes.
- **Behavior removed:** AG Grid's per-column filters and column resize/reorder.
  The page-level search and status filters remain and cover the same needs.
- **Pinned build tool:** `sass` is pinned to an exact version (`1.97.3`).
  Carbon's stylesheets fail to compile on `sass@1.106.x` ("The empty string can't
  be represented as a CSS identifier"). Re-test before bumping.
- Bundle: CSS is ~116 kB gzip (full Carbon stylesheet). Trimming to only the
  components used and route-level code splitting are available follow-ups.
- Carbon's guidelines use sentence case for buttons. Existing copy (e.g. "Record
  Payment") was intentionally left unchanged in this migration.

## Alternatives considered
- **Keep Tailwind and imitate Carbon with utility classes:** cheaper, but never
  matches Carbon's interaction details (focus, keyboard, density) and drifts.
- **Carbon theme over AG Grid:** keeps column filters, but AG Grid never looks native.
- **`@carbon/charts-react`:** the Carbon-native chart library; deferred to avoid
  a second large dependency in this change.

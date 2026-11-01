# UI polish pass

## Fixed
- **Loading placeholders overflowing**: shared fluid `TableSkeleton` (replaces 3 raw `DataTableSkeleton`s) and `StatCardSkeleton` (mirrors the real KPI tile). Added to Dashboard, Accounts, Users, Account detail, My Loans.
- **Page scrolling sideways on phones**: `.lt-table-wrap` is now `position: relative`, so `position: absolute` children (`.lt-visually-hidden`, toggles, popovers) no longer escape the scroll container.
- **Page position jumping between screens**: every `.lt-page` shares one left edge (width variants kept).
- **Centering**: empty states centered by default; text-only buttons centered with balanced padding; overdue amount block right-aligned.
- **Sizing**: form/drawer/modal footer buttons 64px → 48px (Carbon modal footer overridden too); compact KPI tiles; 28px page title on phones; filter chips 24px → 32px; chart titles match panel titles.
- **Coherence**: one heading scale (`.lt-subhead` replaces eyebrow-as-heading), equal-width header actions, dates/amounts never wrap, request-card actions stack under content on phones, filter strips scroll instead of truncating, breadcrumbs wrap.
- **Copy**: Spanish strings in Imports and Payment Attachments translated to English (tests updated); "1 request needs attention" grammar.
- **Inline styles**: 40+ `style={{…}}` one-offs replaced by classes in `index.scss`.

## Verified
tsc clean · 468 tests pass · production build OK · overflow detector 0 findings across 10 screens × (loaded | loading) × 375/768/1056/1440px.

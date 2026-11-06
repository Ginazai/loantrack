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

---

# Second pass: audit (dark theme + feedback)

## Fixed
- **Navbar**: header 48 → 56px via one `$lt-header-h` token (Carbon hard-codes 3rem in ~8 places: header, actions, side-nav top/overlay, header panel, content offset). Wordmark 18px, header icons 24px.
- **Sidebar**: rows 48px, labels 16px, icons 20px (was 32px / 14px / 16px). Group label 14px.
- **Huge gaps in forms**: Carbon sets `flex: 1 1 auto` on `.cds--form-item`, so fields grew to fill a tall drawer. `.lt-form .cds--form-item` is now `flex: 0 0 auto`; fields sit at the 24px token and spare height collects above the footer.
- **Upcoming cycles**: new shared `CycleDates` section used by both the account and payment forms (identical layout and wording).
- **Record Payment tiles**: compact KPI values are 20px so "Nov 14, 2026" no longer wraps.
- **Drop zone**: label centered in an 8rem target.
- **Sample payload**: snippet fills its panel (Carbon caps it at 768px). Ghost "Payload" button no longer gets the 10rem minimum.
- **One page frame**: removed `lt-page--narrow` / `--medium`; every route shares the same left edge and measure.
- **Small text**: ten 12px styles (KPI descriptions, list sub-lines, loan/request metadata, labels) moved to the 14px tier. Form-group labels and helper text stay 12px, as in Carbon.
- **Hit targets**: row icon buttons and "Add payment" 32 → 40px.

## Verified
tsc clean · 468 tests pass · production build OK · impeccable detector 0 findings · overflow detector 0 findings: light + dark, 375 / 768 / 1056 / 1440px, loaded + loading (+ empty at 375, 768, 1056).

## Known and left alone
- Filter chips are 32px (Carbon "lg" tag) and the Users table's expand chevron is Carbon's 32px.
- Users/Dashboard tables scroll horizontally inside their panel on phones, by design.

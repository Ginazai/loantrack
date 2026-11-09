/**
 * Full-screen hold shown while the app asks the server whether a session still exists.
 *
 * Deliberately not Carbon's <InlineLoading>: that component is full-width and left-justified,
 * which is what pinned the old message to the far left of the screen. This one owns its own
 * layout, so it sits dead centre at every viewport size.
 */
export function SessionLoading() {
  return (
    <div className="lt-session" role="status" aria-live="polite">
      <div className="lt-session__card">
        <span className="lt-session__mark" aria-hidden="true">
          <span className="lt-session__mark-l" />
          <span className="lt-session__mark-dot" />
        </span>
        <span className="lt-session__brand">LoanTrack</span>
        <span className="lt-session__bar" aria-hidden="true" />
        <p className="lt-session__text">Restoring your session…</p>
      </div>
    </div>
  );
}

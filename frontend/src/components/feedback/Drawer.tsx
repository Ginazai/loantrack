import { Close } from "@carbon/icons-react";
import { Button } from "@carbon/react";
import { useEffect, useRef } from "react";

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: "md" | "lg";
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Right-hand side panel for create/edit forms — a multi-field form is "step into the
 * workspace for a moment", not a yes/no interruption, so it doesn't use a centered modal.
 * Confirmations (delete, close account) stay as ConfirmDialog.
 *
 * Behaves like a modal dialog: Escape closes, Tab is trapped inside, and focus returns to
 * whatever opened it.
 */
export function Drawer({ title, subtitle, onClose, children, width = "md" }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Land on the first field, not the close button, so a form can be typed into immediately.
    const first = panel?.querySelector<HTMLElement>(
      ".lt-drawer__body input, .lt-drawer__body select, .lt-drawer__body textarea"
    );
    (first ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="lt-drawer">
      <div className="lt-drawer__scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-width={width}
        tabIndex={-1}
        className="lt-drawer__panel"
      >
        <div className="lt-drawer__header">
          <div>
            <h2 className="lt-drawer__title">{title}</h2>
            {subtitle && <p className="lt-drawer__subtitle">{subtitle}</p>}
          </div>
          <Button
            kind="ghost"
            size="lg"
            hasIconOnly
            renderIcon={Close}
            iconDescription="Close"
            tooltipPosition="left"
            onClick={onClose}
          />
        </div>
        <div className="lt-drawer__body">{children}</div>
      </div>
    </div>
  );
}

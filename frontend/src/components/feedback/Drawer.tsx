import { X } from "lucide-react";
import { useEffect } from "react";

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: "md" | "lg";
}

/**
 * Slide-over panel for create/edit forms — the replacement for stacking a
 * modal dialog on top of every CRUD action. A centered modal interrupts the
 * whole screen and implies "stop and decide something small"; a drawer
 * reads as "step into the workspace for a moment," which is the more
 * honest framing for a multi-field form that isn't a yes/no decision.
 *
 * Confirmations (delete, close account) stay as ConfirmDialog — those
 * genuinely are brief binary decisions, where a centered modal is the
 * right pattern, not a misuse of it.
 */
export function Drawer({ title, subtitle, onClose, children, width = "md" }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/40 animate-[fadeIn_0.15s_ease-out]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative h-full w-full ${width === "lg" ? "max-w-xl" : "max-w-md"} bg-base-100 shadow-2xl flex flex-col animate-[slideIn_0.2s_ease-out]`}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-base-300">
          <div className="min-w-0">
            <h2 className="text-lg font-bold truncate">{title}</h2>
            {subtitle && <p className="text-sm text-base-content/50 mt-0.5">{subtitle}</p>}
          </div>
          <button
            className="btn btn-ghost btn-sm btn-circle shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

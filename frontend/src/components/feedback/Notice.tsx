import { InlineNotification } from "@carbon/react";
import type { ReactNode } from "react";

interface Props {
  kind: "error" | "warning" | "success" | "info";
  title?: string;
  children: ReactNode;
  onClose?: () => void;
}

/** Inline, in-context message. Replaces window.alert() and ad-hoc red text. */
export function Notice({ kind, title, children, onClose }: Props) {
  return (
    <InlineNotification
      kind={kind}
      lowContrast
      title={title ?? ""}
      role={kind === "error" || kind === "warning" ? "alert" : "status"}
      hideCloseButton={!onClose}
      onClose={() => {
        onClose?.();
        return false;
      }}
    >
      <span className="cds--inline-notification__subtitle">{children}</span>
    </InlineNotification>
  );
}

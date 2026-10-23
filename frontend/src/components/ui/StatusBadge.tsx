import { Tag } from "@carbon/react";
import type { AccountStatus } from "../../types";

type TagType = "blue" | "green" | "gray" | "red";

// Carbon status tags always pair color with a text label, so state is never color-only.
const cfg: Record<AccountStatus, { label: string; type: TagType }> = {
  open:   { label: "Open",   type: "blue"  },
  active: { label: "Active", type: "green" },
  paid:   { label: "Paid",   type: "gray"  },
  closed: { label: "Closed", type: "red"   },
};

export function StatusBadge({ status }: { status: AccountStatus }) {
  const c = cfg[status] ?? { label: status, type: "gray" as TagType };
  return (
    <Tag size="sm" type={c.type}>
      {c.label}
    </Tag>
  );
}

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Wallet } from "@carbon/icons-react";
import { MemoryRouter } from "react-router-dom";
import { StatCard, StatusBadge, PageHeader } from "./index";

describe("StatCard", () => {
  it("renders title and value", () => {
    render(<StatCard title="Balance" value="$1,000.00" />);
    expect(screen.getByText("Balance")).toBeInTheDocument();
    expect(screen.getByText("$1,000.00")).toBeInTheDocument();
  });

  it("renders an optional description", () => {
    render(<StatCard title="Balance" value="$1,000.00" desc="As of today" />);
    expect(screen.getByText("As of today")).toBeInTheDocument();
  });

  it("omits the description when not provided", () => {
    render(<StatCard title="Balance" value="$1,000.00" />);
    expect(screen.queryByText("As of today")).not.toBeInTheDocument();
  });

  it("flags a danger tone", () => {
    const { container } = render(<StatCard title="Overdue" value="3" tone="danger" />);
    expect(container.firstChild).toHaveClass("lt-kpi--danger");
  });

  it("renders an optional icon", () => {
    const { container } = render(<StatCard title="Balance" value="$1,000.00" Icon={Wallet} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});

describe("StatusBadge", () => {
  it.each([
    ["open", "Open", "cds--tag--blue"],
    ["active", "Active", "cds--tag--green"],
    ["paid", "Paid", "cds--tag--gray"],
    ["closed", "Closed", "cds--tag--red"],
  ] as const)("renders %s correctly", (status, label, cls) => {
    render(<StatusBadge status={status} />);
    // The label is always present as text, so status never relies on color alone.
    const badge = screen.getByText(label).closest(".cds--tag");
    expect(badge).toHaveClass(cls);
  });
});

describe("PageHeader", () => {
  it("renders the title", () => {
    render(<PageHeader title="Accounts" />);
    expect(screen.getByText("Accounts")).toBeInTheDocument();
  });

  it("renders an optional subtitle", () => {
    render(<PageHeader title="Accounts" subtitle="Manage loan accounts" />);
    expect(screen.getByText("Manage loan accounts")).toBeInTheDocument();
  });

  it("renders a breadcrumb trail with the current page marked", () => {
    render(
      <MemoryRouter>
        <PageHeader title="Acme" breadcrumbs={[{ label: "Accounts", to: "/accounts" }, { label: "Acme" }]} />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Accounts" })).toHaveAttribute("href", "/accounts");
    expect(screen.getByRole("heading", { level: 1, name: "Acme" })).toBeInTheDocument();
  });

  it("renders an optional action element", () => {
    render(<PageHeader title="Accounts" action={<button>New</button>} />);
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });
});

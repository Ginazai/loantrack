import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Notice } from "./Notice";
import { EmptyState } from "./EmptyState";
import { StatusBadge } from "../ui";
import type { AccountStatus } from "../../types";

describe("Notice", () => {
  it("uses role=alert for errors and warnings", () => {
    render(<Notice kind="error">Bad</Notice>);
    expect(screen.getByRole("alert")).toHaveTextContent("Bad");
  });

  it("uses role=status for success messages", () => {
    render(<Notice kind="success">Saved</Notice>);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("has no close button unless onClose is given", () => {
    render(<Notice kind="info">FYI</Notice>);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("calls onClose when dismissed", async () => {
    const onClose = vi.fn();
    render(<Notice kind="info" onClose={onClose}>FYI</Notice>);
    await userEvent.setup().click(screen.getByRole("button"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("EmptyState", () => {
  const Icon = (props: object) => <svg data-testid="icon" {...props} />;

  it("renders title only", () => {
    render(<EmptyState Icon={Icon} title="Nothing here" />);
    expect(screen.getByRole("heading", { name: "Nothing here" })).toBeInTheDocument();
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("renders description, action and centering when provided", () => {
    render(
      <EmptyState Icon={Icon} title="T" description="Desc" action={<button>Go</button>} center />,
    );
    expect(screen.getByText("Desc")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveClass("lt-empty--center");
  });
});

describe("StatusBadge", () => {
  it("falls back to a gray tag showing the raw value for an unknown status", () => {
    render(<StatusBadge status={"archived" as AccountStatus} />);
    expect(screen.getByText("archived")).toBeInTheDocument();
  });
});

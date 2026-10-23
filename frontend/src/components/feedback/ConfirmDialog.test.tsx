import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders title and message", () => {
    render(
      <ConfirmDialog title="Delete Account" message="This cannot be undone." onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(screen.getByText("Delete Account")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
  });

  it("calls onConfirm when clicked, with no confirmWord required", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog title="Delete" message="Sure?" onConfirm={onConfirm} onCancel={vi.fn()} />);
    await user.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog title="Delete" message="Sure?" onConfirm={vi.fn()} onCancel={onCancel} />);
    await user.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables confirm until the confirmWord is typed exactly", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        title="Purge"
        message="Type to confirm"
        confirmWord="DELETE"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    const button = screen.getByText("Confirm");
    expect(button).toBeDisabled();

    await user.type(screen.getByPlaceholderText("DELETE"), "wrong");
    expect(button).toBeDisabled();

    await user.clear(screen.getByPlaceholderText("DELETE"));
    await user.type(screen.getByPlaceholderText("DELETE"), "DELETE");
    expect(button).toBeEnabled();

    await user.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("uses a custom confirm label", () => {
    render(
      <ConfirmDialog title="T" message="M" confirmLabel="Purge forever" onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(screen.getByText("Purge forever")).toBeInTheDocument();
  });

  it("applies the dangerous styling when set", () => {
    render(<ConfirmDialog title="T" message="M" dangerous onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Confirm")).toHaveClass("cds--btn--danger");
  });
});

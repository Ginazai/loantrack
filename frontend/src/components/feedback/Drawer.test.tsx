import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Drawer } from "./Drawer";

describe("Drawer", () => {
  it("renders the title, subtitle, and children", () => {
    render(
      <Drawer title="Edit Account" subtitle="Update account details" onClose={vi.fn()}>
        <p>Form content</p>
      </Drawer>
    );
    expect(screen.getByText("Edit Account")).toBeInTheDocument();
    expect(screen.getByText("Update account details")).toBeInTheDocument();
    expect(screen.getByText("Form content")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <Drawer title="Test" onClose={onClose}>
        <p>Content</p>
      </Drawer>
    );
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Drawer title="Test" onClose={onClose}>
        <p>Content</p>
      </Drawer>
    );
    fireEvent.click(container.querySelector('[aria-hidden="true"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus into the panel and returns it to the opener on close", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(
      <Drawer title="Test" onClose={vi.fn()}>
        <input aria-label="First field" />
      </Drawer>
    );
    expect(screen.getByLabelText("First field")).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("keeps Tab focus inside the panel", () => {
    render(
      <Drawer title="Test" onClose={vi.fn()}>
        <input aria-label="Only field" />
      </Drawer>
    );
    const close = screen.getByLabelText("Close");
    const field = screen.getByLabelText("Only field");
    field.focus();
    // Tab from the last focusable wraps to the first (the close button).
    fireEvent.keyDown(field, { key: "Tab" });
    expect(close).toHaveFocus();
    // Shift+Tab from the first wraps to the last.
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(field).toHaveFocus();
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(
      <Drawer title="Test" onClose={onClose}>
        <p>Content</p>
      </Drawer>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses the large width when width='lg'", () => {
    render(
      <Drawer title="Test" onClose={vi.fn()} width="lg">
        <p>Content</p>
      </Drawer>
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("data-width", "lg");
  });

  it("defaults to the medium width", () => {
    render(
      <Drawer title="Test" onClose={vi.fn()}>
        <p>Content</p>
      </Drawer>
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("data-width", "md");
  });
});

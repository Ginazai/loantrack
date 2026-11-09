import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionLoading } from "./SessionLoading";

describe("SessionLoading", () => {
  it("announces that the session is being restored", () => {
    render(<SessionLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Restoring your session");
  });

  it("keeps decorative parts out of the accessibility tree", () => {
    const { container } = render(<SessionLoading />);
    const hidden = container.querySelectorAll('[aria-hidden="true"]');
    expect(hidden.length).toBeGreaterThanOrEqual(2);
  });
});

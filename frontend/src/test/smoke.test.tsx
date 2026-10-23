import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("vitest + RTL smoke test", () => {
  it("renders and queries the DOM", () => {
    render(<div>Hello</div>);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });
});

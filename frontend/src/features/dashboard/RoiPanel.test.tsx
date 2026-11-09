import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RoiPanel } from "./RoiPanel";

const roi = (invested: number, recovered: number) => ({
  invested,
  recovered,
  net: recovered - invested,
  recoveredPct: (recovered / invested) * 100,
});

describe("RoiPanel", () => {
  it("shows what is invested, recovered and still out", () => {
    render(<RoiPanel roi={roi(2000, 500)} />);
    expect(screen.getByText("25.0%")).toBeInTheDocument();
    expect(screen.getByText("$2,000.00")).toBeInTheDocument();
    expect(screen.getByText("$500.00")).toBeInTheDocument();
    expect(screen.getByText("Still to recover")).toBeInTheDocument();
    expect(screen.getByText("$1,500.00")).toBeInTheDocument();
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "25");
  });

  it("switches to net return, in words as well as colour, once capital is back", () => {
    render(<RoiPanel roi={roi(1000, 1100)} />);
    expect(screen.getByText("Net return")).toBeInTheDocument();
    expect(screen.getByText(/Fully recovered · 10\.0% return/)).toBeInTheDocument();
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "100");
  });
});

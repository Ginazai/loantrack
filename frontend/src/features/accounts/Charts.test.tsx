import { describe, it, expect, vi } from "vitest";
import { cloneElement, type ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { BalanceChart, InterestChart } from "./Charts";
import { makePayment } from "../../test/factories";

// jsdom has no layout, so ResponsiveContainer would render nothing. Give it a fixed size.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 600, height: 240 } as never),
  };
});

const payments = [
  makePayment({ id: "p1", payment_date: "2026-02-01", amount: "200.00", interests_accrued: "25.00", balance_after: "825.00" }),
  makePayment({ id: "p2", payment_date: "2026-03-01", amount: "300.00", interests_accrued: "20.00", balance_after: "545.00" }),
];

describe("BalanceChart", () => {
  it("renders a captioned area chart", () => {
    const { container } = render(<BalanceChart payments={payments} borrowAmount="1000.00" />);
    expect(screen.getByText("Balance Over Time")).toBeInTheDocument();
    expect(container.querySelector(".recharts-area")).not.toBeNull();
  });

  it("starts the series at the principal, then one point per payment", () => {
    const { container } = render(<BalanceChart payments={payments} borrowAmount="1000.00" />);
    expect(container.querySelectorAll(".recharts-area-dot")).toHaveLength(3);
    expect(screen.getByText("Start")).toBeInTheDocument();
    expect(screen.getByText("Feb 1, 2026")).toBeInTheDocument();
  });

  it("formats the Y axis compactly", () => {
    render(<BalanceChart payments={payments} borrowAmount="1000.00" />);
    expect(screen.getAllByText(/^\$\d+(\.\d)?k?$/).length).toBeGreaterThan(1);
    expect(screen.getByText("$1k")).toBeInTheDocument();
  });

  it("does not crash on a zero principal (falls back to default ticks)", () => {
    const { container } = render(<BalanceChart payments={[]} borrowAmount="0" />);
    expect(container.querySelector(".recharts-area")).not.toBeNull();
    expect(screen.getByText("$4")).toBeInTheDocument();
  });

  it("shows a tooltip with the formatted balance while hovering the plot", () => {
    const { container } = render(<BalanceChart payments={payments} borrowAmount="1000.00" />);
    fireEvent.mouseMove(container.querySelector(".recharts-wrapper")!, { clientX: 300, clientY: 100 });
    const tip = container.querySelector(".lt-chart-tooltip");
    expect(tip).not.toBeNull();
    expect(tip).toHaveTextContent("Balance");
    expect(tip).toHaveTextContent(/\$[\d,]+\.\d{2}/);
  });
});

describe("InterestChart", () => {
  it("renders a captioned bar chart with a payment and an interest bar per cycle", () => {
    const { container } = render(<InterestChart payments={payments} />);
    expect(screen.getByText("Interest & Payments per Cycle")).toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-bar")).toHaveLength(2);
    expect(container.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(4);
  });

  it("labels the legend with friendly names", () => {
    render(<InterestChart payments={payments} />);
    expect(screen.getByText("Interest")).toBeInTheDocument();
    expect(screen.getByText("Payment")).toBeInTheDocument();
  });

  it("does not crash with no payments", () => {
    const { container } = render(<InterestChart payments={[]} />);
    expect(screen.getByText("Interest & Payments per Cycle")).toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(0);
  });
});

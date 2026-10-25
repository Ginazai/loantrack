import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ServerWakingNotice } from "./ServerWakingNotice";
import { useConnectionStore } from "../../stores/connectionStore";

describe("ServerWakingNotice", () => {
  beforeEach(() => useConnectionStore.setState({ waking: false }));

  it("renders nothing while the server is reachable", () => {
    const { container } = render(<ServerWakingNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it("explains the wait while the backend is waking, and disappears afterwards", () => {
    render(<ServerWakingNotice />);

    act(() => useConnectionStore.getState().setWaking(true));
    expect(screen.getByRole("status")).toHaveTextContent(/starting up/i);

    act(() => useConnectionStore.getState().setWaking(false));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

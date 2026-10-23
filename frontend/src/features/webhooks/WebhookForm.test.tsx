import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WebhookForm } from "./WebhookForm";

describe("WebhookForm", () => {
  it("defaults to payment.added checked", () => {
    render(<WebhookForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const checkbox = screen.getByRole("checkbox", { name: "Payment Added" });
    expect(checkbox).toBeChecked();
  });

  it("rejects an invalid URL", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<WebhookForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(
      screen.getByPlaceholderText("https://your-n8n-instance.com/webhook/..."),
      "not-a-url"
    );
    await user.click(screen.getByText("Save Webhook"));

    expect(await screen.findByText("Must be a valid URL")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("requires at least one event selected", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<WebhookForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(
      screen.getByPlaceholderText("https://your-n8n-instance.com/webhook/..."),
      "https://example.com/hook"
    );
    // Uncheck the one default event.
    const checkbox = screen.getByRole("checkbox", { name: "Payment Added" });
    await user.click(checkbox);
    await user.click(screen.getByText("Save Webhook"));

    expect(await screen.findByText("Select at least one event")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits with the selected events and URL", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<WebhookForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(
      screen.getByPlaceholderText("https://your-n8n-instance.com/webhook/..."),
      "https://example.com/hook"
    );
    const cycleCheckbox = screen.getByRole("checkbox", { name: "Cycle Closed" });
    await user.click(cycleCheckbox);
    await user.click(screen.getByText("Save Webhook"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted.target_url).toBe("https://example.com/hook");
    expect(submitted.events).toEqual(expect.arrayContaining(["payment.added", "cycle.closed"]));
  });

  it("calls onCancel", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<WebhookForm onSubmit={vi.fn()} onCancel={onCancel} />);
    await user.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows the HMAC security note", () => {
    render(<WebhookForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("X-Webhook-Signature")).toBeInTheDocument();
  });
});

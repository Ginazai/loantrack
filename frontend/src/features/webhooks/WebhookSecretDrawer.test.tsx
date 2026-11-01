import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WebhookSecretDrawer } from "./WebhookSecretDrawer";

const renderDrawer = (props: Partial<React.ComponentProps<typeof WebhookSecretDrawer>> = {}) => {
  const onClose = vi.fn();
  render(
    <WebhookSecretDrawer
      secret="whsec_abc123"
      targetUrl="https://hooks.example/in"
      onClose={onClose}
      {...props}
    />,
  );
  return onClose;
};

describe("WebhookSecretDrawer", () => {
  it("shows the secret, the endpoint and a one-time warning", () => {
    renderDrawer();
    const dialog = screen.getByRole("dialog", { name: "Webhook signing secret" });
    expect(within(dialog).getByText("whsec_abc123")).toBeInTheDocument();
    expect(within(dialog).getByText("https://hooks.example/in")).toBeInTheDocument();
    expect(within(dialog).getByText(/won't be shown again/)).toBeInTheDocument();
  });

  it("tells the receiver how to verify against the raw body", () => {
    renderDrawer();
    expect(screen.getByText(/X-Webhook-Signature/)).toBeInTheDocument();
    expect(screen.getByText(/RAW request body/)).toBeInTheDocument();
    expect(screen.getByText(/timingSafeEqual/)).toBeInTheDocument();
  });

  it("explains that the old secret is dead after a rotation", () => {
    renderDrawer({ rotated: true });
    expect(screen.getByRole("dialog", { name: "New signing secret" })).toBeInTheDocument();
    expect(screen.getByText(/previous secret has stopped working/)).toBeInTheDocument();
  });

  it("closes from the confirm button", async () => {
    const onClose = renderDrawer();
    await userEvent.setup().click(screen.getByRole("button", { name: "I've saved it" }));
    expect(onClose).toHaveBeenCalled();
  });
});

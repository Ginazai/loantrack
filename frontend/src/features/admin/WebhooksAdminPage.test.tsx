import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WebhooksAdminPage from "./WebhooksAdminPage";
import { adminApi } from "../../api";
import { makeWebhook } from "../../test/factories";
import { renderWithProviders } from "../../test/utils";

vi.mock("../../api", () => ({
  adminApi: {
    listGlobalWebhooks: vi.fn(),
    createGlobalWebhook: vi.fn(),
    deleteGlobalWebhook: vi.fn(),
    toggleGlobalWebhook: vi.fn(),
    rotateGlobalWebhookSecret: vi.fn(),
  },
}));
const api = adminApi as unknown as Record<
  | "listGlobalWebhooks"
  | "createGlobalWebhook"
  | "deleteGlobalWebhook"
  | "toggleGlobalWebhook"
  | "rotateGlobalWebhookSecret",
  ReturnType<typeof vi.fn>
>;

const active = makeWebhook({ id: "w1", target_url: "https://a.example/hook", events: ["payment.added", "cycle.closed"] });
const paused = makeWebhook({ id: "w2", target_url: "https://b.example/hook", is_active: false, events: ["account.created"] });

describe("WebhooksAdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listGlobalWebhooks.mockResolvedValue([active, paused]);
  });

  it("shows a loading placeholder", () => {
    api.listGlobalWebhooks.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<WebhooksAdminPage />);
    expect(screen.getByLabelText("Loading webhooks")).toHaveAttribute("aria-busy", "true");
  });

  it("shows an empty state with a call to action", async () => {
    api.listGlobalWebhooks.mockResolvedValue([]);
    renderWithProviders(<WebhooksAdminPage />);
    expect(await screen.findByText("No global webhooks configured.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add webhook" })).toHaveLength(2);
  });

  it("lists webhooks with state, URL and subscribed events", async () => {
    renderWithProviders(<WebhooksAdminPage />);
    expect(await screen.findByText("https://a.example/hook")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getAllByText("global")).toHaveLength(2);
    expect(screen.getByText("payment.added")).toBeInTheDocument();
    expect(screen.getByText("cycle.closed")).toBeInTheDocument();
    expect(screen.getAllByText(/^Created /)).toHaveLength(2);
  });

  it("toggles the sample payload", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WebhooksAdminPage />);
    await screen.findByText("https://a.example/hook");
    await user.click(screen.getByRole("button", { name: "Payload" }));
    expect(screen.getByRole("heading", { name: "Sample Payload" })).toBeInTheDocument();
    expect(screen.getByText(/"event": "account\.created"/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide payload" }));
    expect(screen.queryByRole("heading", { name: "Sample Payload" })).toBeNull();
  });

  describe("pausing and resuming", () => {
    it("pauses an active webhook", async () => {
      api.toggleGlobalWebhook.mockResolvedValue({ ...active, is_active: false });
      const user = userEvent.setup();
      renderWithProviders(<WebhooksAdminPage />);
      await user.click(await screen.findByRole("switch", { name: "Webhook active — switch off to pause" }));
      await waitFor(() => expect(api.toggleGlobalWebhook).toHaveBeenCalledWith("w1", false));
      await waitFor(() => expect(screen.getAllByText("Paused")).toHaveLength(2));
    });

    it("resumes a paused webhook", async () => {
      api.toggleGlobalWebhook.mockResolvedValue({ ...paused, is_active: true });
      const user = userEvent.setup();
      renderWithProviders(<WebhooksAdminPage />);
      await user.click(await screen.findByRole("switch", { name: "Webhook paused — switch on to resume" }));
      await waitFor(() => expect(api.toggleGlobalWebhook).toHaveBeenCalledWith("w2", true));
      await waitFor(() => expect(screen.getAllByText("Active")).toHaveLength(2));
    });
  });

  describe("deleting", () => {
    it("confirms, deletes and removes the webhook", async () => {
      api.deleteGlobalWebhook.mockResolvedValue({});
      const user = userEvent.setup();
      renderWithProviders(<WebhooksAdminPage />);
      await screen.findByText("https://a.example/hook");
      await user.click(screen.getAllByRole("button", { name: "Delete webhook" })[0]);
      const dialog = screen.getByRole("dialog", { name: "Delete Global Webhook" });
      await user.click(within(dialog).getByRole("button", { name: "Delete webhook" }));

      await waitFor(() => expect(api.deleteGlobalWebhook).toHaveBeenCalledWith("w1"));
      await waitFor(() => expect(screen.queryByText("https://a.example/hook")).toBeNull());
      expect(screen.getByText("https://b.example/hook")).toBeInTheDocument();
    });

    it("keeps the webhook when cancelled", async () => {
      const user = userEvent.setup();
      renderWithProviders(<WebhooksAdminPage />);
      await screen.findByText("https://a.example/hook");
      await user.click(screen.getAllByRole("button", { name: "Delete webhook" })[0]);
      await user.click(within(screen.getByRole("dialog", { name: "Delete Global Webhook" })).getByRole("button", { name: "Cancel" }));
      expect(api.deleteGlobalWebhook).not.toHaveBeenCalled();
      expect(screen.getByText("https://a.example/hook")).toBeInTheDocument();
    });
  });

  describe("creating", () => {
    const openDrawer = async (user: ReturnType<typeof userEvent.setup>) => {
      renderWithProviders(<WebhooksAdminPage />);
      await screen.findByText("https://a.example/hook");
      await user.click(screen.getAllByRole("button", { name: "Add webhook" })[0]);
      return screen.getByRole("dialog", { name: "New Global Webhook" });
    };

    it("requires a URL and at least one event", async () => {
      const user = userEvent.setup();
      const dialog = await openDrawer(user);
      await user.click(within(dialog).getByRole("button", { name: "Create webhook" }));
      expect(await within(dialog).findByText("URL and at least one event are required")).toBeInTheDocument();
      expect(api.createGlobalWebhook).not.toHaveBeenCalled();
    });

    it("requires an event even when a URL is given", async () => {
      const user = userEvent.setup();
      const dialog = await openDrawer(user);
      await user.type(within(dialog).getByLabelText("Endpoint URL"), "https://c.example");
      await user.click(within(dialog).getByRole("button", { name: "Create webhook" }));
      expect(await within(dialog).findByText("URL and at least one event are required")).toBeInTheDocument();
    });

    it("creates the webhook, adds it to the top of the list and closes", async () => {
      api.createGlobalWebhook.mockResolvedValue({
        ...makeWebhook({ id: "w3", target_url: "https://c.example", events: ["account.created", "payment.added"] }),
        secret: "whsec_created-secret",
      });
      const user = userEvent.setup();
      const dialog = await openDrawer(user);
      await user.type(within(dialog).getByLabelText("Endpoint URL"), "https://c.example");
      await user.click(within(dialog).getByRole("checkbox", { name: "Account Created" }));
      await user.click(within(dialog).getByRole("checkbox", { name: "Payment Added" }));
      await user.click(within(dialog).getByRole("button", { name: "Create webhook" }));

      await waitFor(() =>
        expect(api.createGlobalWebhook).toHaveBeenCalledWith({
          target_url: "https://c.example",
          events: ["account.created", "payment.added"],
        }),
      );
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "New Global Webhook" })).toBeNull());
      const urls = screen.getAllByText(/^https:\/\/.*\.example/).map((n) => n.textContent);
      expect(urls[0]).toBe("https://c.example");
    });

    it("shows the signing secret once after creating, and not in the list", async () => {
      api.createGlobalWebhook.mockResolvedValue({
        ...makeWebhook({ id: "w3", target_url: "https://c.example", events: ["payment.added"] }),
        secret: "whsec_created-secret",
      });
      const user = userEvent.setup();
      const dialog = await openDrawer(user);
      await user.type(within(dialog).getByLabelText("Endpoint URL"), "https://c.example");
      await user.click(within(dialog).getByRole("checkbox", { name: "Payment Added" }));
      await user.click(within(dialog).getByRole("button", { name: "Create webhook" }));

      const reveal = await screen.findByRole("dialog", { name: "Webhook signing secret" });
      expect(within(reveal).getByText("whsec_created-secret")).toBeInTheDocument();
      expect(within(reveal).getByText(/won't be shown again/)).toBeInTheDocument();

      await user.click(within(reveal).getByRole("button", { name: "I've saved it" }));
      await waitFor(() => expect(screen.queryByText("whsec_created-secret")).toBeNull());
    });

    it("lets an event be unchecked again", async () => {
      const user = userEvent.setup();
      const dialog = await openDrawer(user);
      const box = within(dialog).getByRole("checkbox", { name: "Cycle Closed" });
      await user.click(box);
      expect(box).toBeChecked();
      await user.click(box);
      expect(box).not.toBeChecked();
    });

    it("shows the server's error and stays open", async () => {
      api.createGlobalWebhook.mockRejectedValue({ response: { data: { detail: "Invalid URL" } } });
      const user = userEvent.setup();
      const dialog = await openDrawer(user);
      await user.type(within(dialog).getByLabelText("Endpoint URL"), "nope");
      await user.click(within(dialog).getByRole("checkbox", { name: "Status Changed" }));
      await user.click(within(dialog).getByRole("button", { name: "Create webhook" }));
      expect(await within(dialog).findByText("Invalid URL")).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "New Global Webhook" })).toBeInTheDocument();
    });

    it("cancel closes the drawer", async () => {
      const user = userEvent.setup();
      const dialog = await openDrawer(user);
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog", { name: "New Global Webhook" })).toBeNull();
    });
  });

  describe("rotating a signing secret", () => {
    it("asks first, then reveals the replacement secret once", async () => {
      api.rotateGlobalWebhookSecret.mockResolvedValue({ ...active, secret: "whsec_rotated-secret" });
      const user = userEvent.setup();
      renderWithProviders(<WebhooksAdminPage />);
      await screen.findByText("https://a.example/hook");

      await user.click(screen.getAllByRole("button", { name: "Rotate secret" })[0]);
      expect(api.rotateGlobalWebhookSecret).not.toHaveBeenCalled(); // not until confirmed
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rotate secret" }));

      await waitFor(() => expect(api.rotateGlobalWebhookSecret).toHaveBeenCalledWith("w1"));
      const reveal = await screen.findByRole("dialog", { name: "New signing secret" });
      expect(within(reveal).getByText("whsec_rotated-secret")).toBeInTheDocument();
      expect(within(reveal).getByText(/previous secret has stopped working/)).toBeInTheDocument();
    });

    it("does nothing when cancelled", async () => {
      const user = userEvent.setup();
      renderWithProviders(<WebhooksAdminPage />);
      await screen.findByText("https://a.example/hook");
      await user.click(screen.getAllByRole("button", { name: "Rotate secret" })[0]);
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
      expect(api.rotateGlobalWebhookSecret).not.toHaveBeenCalled();
    });
  });
});

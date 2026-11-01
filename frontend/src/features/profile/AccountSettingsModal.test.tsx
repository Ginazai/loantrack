import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountSettingsModal } from "./AccountSettingsModal";
import { authApi } from "../../api";
import { useAuthStore } from "../../stores/authStore";
import { makeUser } from "../../test/factories";

vi.mock("../../api", () => ({ authApi: { updateMe: vi.fn() } }));

const save = () => screen.getByRole("button", { name: "Save changes" });

describe("AccountSettingsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ accessToken: "t", status: "authenticated", user: makeUser({ full_name: "Ada Lovelace" }) });
  });

  it("prefills the name and shows the email as read-only", () => {
    render(<AccountSettingsModal onClose={vi.fn()} />);
    expect(screen.getByLabelText("Display Name")).toHaveValue("Ada Lovelace");
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.getByLabelText("Email")).toHaveValue("user@test.dev");
  });

  it("closes without calling the API when nothing changed", async () => {
    const onClose = vi.fn();
    render(<AccountSettingsModal onClose={onClose} />);
    await userEvent.setup().click(save());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(authApi.updateMe).not.toHaveBeenCalled();
  });

  it("rejects mismatched passwords", async () => {
    const user = userEvent.setup();
    render(<AccountSettingsModal onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("New Password"), "password-one");
    await user.type(screen.getByLabelText("Confirm Password"), "password-two");
    await user.click(save());
    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(authApi.updateMe).not.toHaveBeenCalled();
  });

  it("rejects passwords shorter than 8 characters", async () => {
    const user = userEvent.setup();
    render(<AccountSettingsModal onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("New Password"), "short");
    await user.type(screen.getByLabelText("Confirm Password"), "short");
    await user.click(save());
    expect(await screen.findByText("Password must be at least 8 characters")).toBeInTheDocument();
    expect(authApi.updateMe).not.toHaveBeenCalled();
  });

  it("sends only the changed name, updates the store and closes after confirming", async () => {
    const onClose = vi.fn();
    (authApi.updateMe as any).mockResolvedValue(makeUser({ full_name: "Ada King" }));
    const user = userEvent.setup();
    render(<AccountSettingsModal onClose={onClose} />);

    await user.clear(screen.getByLabelText("Display Name"));
    await user.type(screen.getByLabelText("Display Name"), "Ada King");
    await user.click(save());

    expect(await screen.findByText("Changes saved.")).toBeInTheDocument();
    expect(authApi.updateMe).toHaveBeenCalledWith({ full_name: "Ada King" });
    expect(useAuthStore.getState().user?.full_name).toBe("Ada King");
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 });
  });

  it("won't set a new password without the current one", async () => {
    const user = userEvent.setup();
    render(<AccountSettingsModal onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("New Password"), "a-long-password");
    await user.type(screen.getByLabelText("Confirm Password"), "a-long-password");
    await user.click(save());
    expect(
      await screen.findByText("Enter your current password to set a new one"),
    ).toBeInTheDocument();
    expect(authApi.updateMe).not.toHaveBeenCalled();
  });

  it("sends the current and new password when valid and matching", async () => {
    (authApi.updateMe as any).mockResolvedValue(makeUser());
    const user = userEvent.setup();
    render(<AccountSettingsModal onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Current Password"), "the-old-one");
    await user.type(screen.getByLabelText("New Password"), "a-long-password");
    await user.type(screen.getByLabelText("Confirm Password"), "a-long-password");
    await user.click(save());
    await waitFor(() =>
      expect(authApi.updateMe).toHaveBeenCalledWith({
        current_password: "the-old-one",
        new_password: "a-long-password",
      }),
    );
  });

  it("shows the server's message when the current password is wrong", async () => {
    (authApi.updateMe as any).mockRejectedValue({
      response: { status: 403, data: { detail: "Current password is incorrect" } },
    });
    const user = userEvent.setup();
    render(<AccountSettingsModal onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Current Password"), "wrong");
    await user.type(screen.getByLabelText("New Password"), "a-long-password");
    await user.type(screen.getByLabelText("Confirm Password"), "a-long-password");
    await user.click(save());
    expect(await screen.findByText("Current password is incorrect")).toBeInTheDocument();
  });

  it("shows the server's error message when saving fails", async () => {
    (authApi.updateMe as any).mockRejectedValue({ response: { data: { detail: "Name taken" } } });
    const user = userEvent.setup();
    render(<AccountSettingsModal onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Display Name"), "x");
    await user.click(save());
    expect(await screen.findByText("Name taken")).toBeInTheDocument();
  });

  it("Cancel closes the drawer", async () => {
    const onClose = vi.fn();
    render(<AccountSettingsModal onClose={onClose} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});

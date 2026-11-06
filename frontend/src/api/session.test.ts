import { describe, it, expect, vi, beforeEach } from "vitest";
import { restoreSession } from "./session";
import { useAuthStore } from "../stores/authStore";
import { refreshSession } from "./client";
import { authApi } from "./index";
import { makeUser } from "../test/factories";

vi.mock("./client", () => ({ refreshSession: vi.fn() }));
vi.mock("./index", () => ({ authApi: { me: vi.fn() } }));

describe("restoreSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ accessToken: null, user: null, status: "unknown" });
  });

  it("trades the refresh cookie for a token, loads the profile and ends up authenticated", async () => {
    const me = makeUser({ full_name: "Ada" });
    (refreshSession as any).mockImplementation(async () => {
      useAuthStore.getState().setAccessToken("fresh");
      return "fresh";
    });
    (authApi.me as any).mockResolvedValue(me);

    await restoreSession();

    const s = useAuthStore.getState();
    expect(s.status).toBe("authenticated");
    expect(s.accessToken).toBe("fresh");
    expect(s.user).toEqual(me);
  });

  it("treats no/expired cookie as signed out, not as an error", async () => {
    (refreshSession as any).mockRejectedValue({ response: { status: 401 } });

    await expect(restoreSession()).resolves.toBeUndefined();

    const s = useAuthStore.getState();
    expect(s.status).toBe("anonymous");
    expect(s.accessToken).toBeNull();
    expect(authApi.me).not.toHaveBeenCalled();
  });

  it("signs out if the profile cannot be loaded after a refresh", async () => {
    (refreshSession as any).mockResolvedValue("fresh");
    (authApi.me as any).mockRejectedValue(new Error("boom"));

    await restoreSession();

    expect(useAuthStore.getState().status).toBe("anonymous");
  });
});

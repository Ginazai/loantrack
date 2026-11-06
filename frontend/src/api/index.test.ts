import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./client", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    defaults: { baseURL: "/api/v1" },
  },
}));

import client from "./client";
import {
  accountsApi,
  adminApi,
  attachmentsApi,
  authApi,
  importsApi,
  loanRequestsApi,
  paymentsApi,
  webhooksApi,
} from "./index";

const http = client as unknown as Record<"get" | "post" | "patch" | "delete", ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of ["get", "post", "patch", "delete"] as const) http[m].mockResolvedValue({ data: { m } });
});

describe("authApi", () => {
  it("login posts credentials and unwraps data", async () => {
    const creds = { email: "a@b.c", password: "pw" };
    expect(await authApi.login(creds)).toEqual({ m: "post" });
    expect(http.post).toHaveBeenCalledWith("/auth/login", creds);
  });
  it("me gets the current user", async () => {
    expect(await authApi.me()).toEqual({ m: "get" });
    expect(http.get).toHaveBeenCalledWith("/auth/me");
  });
  it("updateMe patches the profile", async () => {
    await authApi.updateMe({ full_name: "New" });
    expect(http.patch).toHaveBeenCalledWith("/auth/me", { full_name: "New" });
  });
  it("refresh posts the refresh token", async () => {
    await authApi.refresh("tok");
    expect(http.post).toHaveBeenCalledWith("/auth/refresh", { refresh_token: "tok" });
  });
  it("logout posts to /auth/logout", async () => {
    await authApi.logout();
    expect(http.post).toHaveBeenCalledWith("/auth/logout");
  });
});

describe("accountsApi", () => {
  it("list sends status/search params with repeated-key serialisation", async () => {
    await accountsApi.list({ status: ["open", "paid"], search: "bob" });
    expect(http.get).toHaveBeenCalledWith("/accounts", {
      params: { status: ["open", "paid"], search: "bob" },
      paramsSerializer: { indexes: null },
    });
  });
  it("list works with no params", async () => {
    await accountsApi.list();
    expect(http.get.mock.calls[0][1].params).toEqual({ status: undefined, search: undefined });
  });
  it("get fetches one account", async () => {
    await accountsApi.get("a1");
    expect(http.get).toHaveBeenCalledWith("/accounts/a1");
  });
  it("create converts the UI percentage into a fraction", async () => {
    await accountsApi.create({
      account_name: "Loan",
      borrow_amount: 1000,
      rate: 5,
      cycle: 15,
      start_date: "2026-01-01",
      linked_user_id: "u1",
    });
    expect(http.post).toHaveBeenCalledWith("/accounts", {
      account_name: "Loan",
      borrow_amount: 1000,
      rate: 0.05,
      cycle: 15,
      start_date: "2026-01-01",
      linked_user_id: "u1",
    });
  });
  it("create omits an empty linked_user_id", async () => {
    await accountsApi.create({
      account_name: "L",
      borrow_amount: 1,
      rate: 1,
      cycle: 30,
      start_date: "2026-01-01",
      linked_user_id: "",
    });
    expect(http.post.mock.calls[0][1].linked_user_id).toBeUndefined();
  });
  it("update sends only the fields that were provided, rate as a fraction", async () => {
    await accountsApi.update("a1", { account_name: "X", rate: 7, status: "closed" });
    expect(http.patch).toHaveBeenCalledWith("/accounts/a1", { account_name: "X", rate: 0.07, status: "closed" });
  });
  it("update with nothing sends an empty payload", async () => {
    await accountsApi.update("a1", {});
    expect(http.patch).toHaveBeenCalledWith("/accounts/a1", {});
  });
  it("close posts the reason", async () => {
    await accountsApi.close("a1", "done");
    expect(http.post).toHaveBeenCalledWith("/accounts/a1/close", { close_reason: "done" });
  });
  it("purge only adds ?force=true when forced", async () => {
    await accountsApi.purge("a1");
    await accountsApi.purge("a1", true);
    expect(http.delete).toHaveBeenNthCalledWith(1, "/accounts/a1");
    expect(http.delete).toHaveBeenNthCalledWith(2, "/accounts/a1?force=true");
  });
  it("cyclePreview gets the upcoming dates", async () => {
    await accountsApi.cyclePreview("a1");
    expect(http.get).toHaveBeenCalledWith("/accounts/a1/cycle-preview");
  });
});

describe("paymentsApi", () => {
  it("list and delete hit the nested routes", async () => {
    await paymentsApi.list("a1");
    await paymentsApi.delete("a1", "p1");
    expect(http.get).toHaveBeenCalledWith("/accounts/a1/payments");
    expect(http.delete).toHaveBeenCalledWith("/accounts/a1/payments/p1");
  });
  it("auto payments send only amount and method (no date)", async () => {
    await paymentsApi.add("a1", { amount: 50, method: "auto", payment_date: "2026-01-01" });
    expect(http.post).toHaveBeenCalledWith("/accounts/a1/payments", { amount: 50, method: "auto" });
  });
  it("manual payments send the full form", async () => {
    const data = { amount: 50, method: "manual" as const, payment_date: "2026-01-01" };
    await paymentsApi.add("a1", data);
    expect(http.post).toHaveBeenCalledWith("/accounts/a1/payments", data);
  });
});

describe("attachmentsApi", () => {
  it("list/delete use the nested attachment routes", async () => {
    await attachmentsApi.list("a1", "p1");
    await attachmentsApi.delete("a1", "p1", "t1");
    expect(http.get).toHaveBeenCalledWith("/accounts/a1/payments/p1/attachments");
    expect(http.delete).toHaveBeenCalledWith("/accounts/a1/payments/p1/attachments/t1");
  });
  it("upload posts the file as multipart form data", async () => {
    const file = new File(["x"], "r.pdf", { type: "application/pdf" });
    await attachmentsApi.upload("a1", "p1", file);
    const [url, body, opts] = http.post.mock.calls[0];
    expect(url).toBe("/accounts/a1/payments/p1/attachments");
    expect((body as FormData).get("file")).toBe(file);
    expect(opts.headers["Content-Type"]).toBe("multipart/form-data");
  });

  describe("download", () => {
    let click: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => "blob:fake");
      URL.revokeObjectURL = vi.fn();
      click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    });
    afterEach(() => click.mockRestore());

    it("fetches a blob through the authenticated client and triggers a save", async () => {
      const blob = new Blob(["pdf"]);
      http.get.mockResolvedValue({ data: blob });

      await attachmentsApi.download("a1", "p1", "t1", "receipt.pdf");

      expect(http.get).toHaveBeenCalledWith("/accounts/a1/payments/p1/attachments/t1", {
        responseType: "blob",
      });
      expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
      expect(click).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
      expect(document.querySelector("a[download]")).toBeNull(); // temp link cleaned up
    });
  });
});

describe("webhooksApi", () => {
  it("covers list/create/delete", async () => {
    const data = { target_url: "https://x.y", events: ["payment.added" as const] };
    await webhooksApi.list("a1");
    await webhooksApi.create("a1", data);
    await webhooksApi.delete("a1", "w1");
    expect(http.get).toHaveBeenCalledWith("/accounts/a1/webhooks");
    expect(http.post).toHaveBeenCalledWith("/accounts/a1/webhooks", data);
    expect(http.delete).toHaveBeenCalledWith("/accounts/a1/webhooks/w1");
  });
});

describe("adminApi", () => {
  it("user management routes", async () => {
    await adminApi.listUsers();
    await adminApi.createUser({ email: "a@b.c", password: "pw", full_name: "A", role: "user" });
    await adminApi.updateUser("u1", { is_active: false });
    await adminApi.deleteUser("u1");
    await adminApi.getUserAccounts("u1");
    expect(http.get).toHaveBeenCalledWith("/admin/users");
    expect(http.post).toHaveBeenCalledWith("/admin/users", expect.objectContaining({ email: "a@b.c" }));
    expect(http.patch).toHaveBeenCalledWith("/admin/users/u1", { is_active: false });
    expect(http.delete).toHaveBeenCalledWith("/admin/users/u1");
    expect(http.get).toHaveBeenCalledWith("/admin/users/u1/accounts");
  });
  it("global webhook routes", async () => {
    const data = { target_url: "https://x.y", events: ["cycle.closed" as const] };
    await adminApi.listGlobalWebhooks();
    await adminApi.createGlobalWebhook(data);
    await adminApi.toggleGlobalWebhook("w1", false);
    await adminApi.deleteGlobalWebhook("w1");
    expect(http.get).toHaveBeenCalledWith("/admin/webhooks");
    expect(http.post).toHaveBeenCalledWith("/admin/webhooks", data);
    expect(http.patch).toHaveBeenCalledWith("/admin/webhooks/w1", { is_active: false });
    expect(http.delete).toHaveBeenCalledWith("/admin/webhooks/w1");
  });
  it("deleteRequest hits the admin requests route", async () => {
    await adminApi.deleteRequest("r1");
    expect(http.delete).toHaveBeenCalledWith("/admin/requests/r1");
  });
  it("CSV exports open the right URLs in a new tab", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    adminApi.exportAccountsCsv();
    adminApi.exportPaymentsCsv();
    adminApi.exportAccountFullCsv("a1");
    expect(open).toHaveBeenNthCalledWith(1, "/api/v1/admin/export/accounts.csv", "_blank");
    expect(open).toHaveBeenNthCalledWith(2, "/api/v1/admin/export/payments.csv", "_blank");
    expect(open).toHaveBeenNthCalledWith(3, "/api/v1/admin/export/accounts/a1/full.csv", "_blank");
    open.mockRestore();
  });
});

describe("loanRequestsApi", () => {
  it("borrower routes", async () => {
    await loanRequestsApi.listMine();
    await loanRequestsApi.create({ account_name: "R", borrow_amount: 10 });
    await loanRequestsApi.cancel("r1");
    expect(http.get).toHaveBeenCalledWith("/loan-requests");
    expect(http.post).toHaveBeenCalledWith("/loan-requests", { account_name: "R", borrow_amount: 10 });
    expect(http.delete).toHaveBeenCalledWith("/loan-requests/r1");
  });
  it("admin list/open routes", async () => {
    await loanRequestsApi.listAll();
    await loanRequestsApi.open("r1");
    expect(http.get).toHaveBeenCalledWith("/loan-requests/admin/all");
    expect(http.get).toHaveBeenCalledWith("/loan-requests/admin/r1/open");
  });
  it("review converts the approval rate from % to a fraction", async () => {
    await loanRequestsApi.review("r1", { status: "approved", rate: 5, cycle: 30 });
    expect(http.patch).toHaveBeenCalledWith("/loan-requests/admin/r1", {
      status: "approved",
      rate: 0.05,
      cycle: 30,
    });
  });
  it("review leaves rate undefined for a rejection", async () => {
    await loanRequestsApi.review("r1", { status: "rejected", rejection_reason: "no" });
    expect(http.patch.mock.calls[0][1].rate).toBeUndefined();
  });
});

describe("importsApi", () => {
  it("preview uploads the CSV as multipart", async () => {
    const file = new File(["a,b"], "x.csv", { type: "text/csv" });
    await importsApi.preview(file);
    const [url, body, opts] = http.post.mock.calls[0];
    expect(url).toBe("/admin/imports/preview");
    expect((body as FormData).get("file")).toBe(file);
    expect(opts.headers["Content-Type"]).toBe("multipart/form-data");
  });
  it("commit/list/get routes", async () => {
    const mappings = [{ source_ref: "r", action: "skip" as const }];
    await importsApi.commit("b1", mappings);
    await importsApi.list();
    await importsApi.get("b1");
    expect(http.post).toHaveBeenCalledWith("/admin/imports/b1/commit", { mappings });
    expect(http.get).toHaveBeenCalledWith("/admin/imports");
    expect(http.get).toHaveBeenCalledWith("/admin/imports/b1");
  });
});

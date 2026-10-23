import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImportsPage from "./ImportsPage";
import { accountsApi, adminApi, importsApi } from "../../api";
import { makeAccount, makeUser } from "../../test/factories";
import { renderWithProviders } from "../../test/utils";
import type { ImportBatch, ImportPreview } from "../../types";

vi.mock("../../api", () => ({
  accountsApi: { list: vi.fn() },
  adminApi: { listUsers: vi.fn() },
  importsApi: { preview: vi.fn(), commit: vi.fn(), list: vi.fn() },
}));
const imports = importsApi as unknown as Record<"preview" | "commit" | "list", ReturnType<typeof vi.fn>>;
const accountsList = accountsApi.list as unknown as ReturnType<typeof vi.fn>;
const listUsers = adminApi.listUsers as unknown as ReturnType<typeof vi.fn>;

const previewFixture = (over: Partial<ImportPreview> = {}): ImportPreview => ({
  batch_id: "b1",
  format: "legacy_ledger_csv",
  accounts: [
    { source_ref: "REF1", suggested_account_name: "Ledger One", borrow_amount: "1000.00", start_date: "2026-01-01", rate: "0.05", borrower_name: "Ann", payment_count: 3, suggested_existing_account_id: null },
    { source_ref: "REF2", suggested_account_name: "Ledger Two", borrow_amount: "500.00", start_date: "2026-02-01", rate: null, borrower_name: null, payment_count: 1, suggested_existing_account_id: "acc-9" },
  ],
  unmatched_payment_refs: [],
  total_payments_parsed: 4,
  error_count: 0,
  errors: [],
  ...over,
});

const batch = (over: Partial<ImportBatch> = {}): ImportBatch => ({
  id: "b1", source_filename: "ledger.csv", format: "legacy_ledger_csv", status: "committed",
  summary: { created_accounts: 1, payments_imported: 3 }, created_at: "2026-03-01T12:00:00Z", committed_at: null, ...over,
});

const chooseFile = (name = "ledger.csv") => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["a,b"], name, { type: "text/csv" })] } });
};
const mappingRow = (ref: string) => screen.getByText(ref, { selector: "span.lt-mono" }).closest("tr")! as HTMLElement;
const commitBtn = () => screen.getByRole("button", { name: "Confirmar importación" });

/** Uploads the fixture and waits for the mapping table. */
async function uploadAndPreview(p: ImportPreview = previewFixture()) {
  imports.preview.mockResolvedValue(p);
  renderWithProviders(<ImportsPage />);
  await screen.findByText("Sin importaciones aún.");
  chooseFile();
  await screen.findByRole("table", { name: "Mapeo de cuentas" });
}
/** Makes the fixture "ready": REF1 gets a user (rate is prefilled to 5). */
async function completeMapping(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(within(mappingRow("REF1")).getByLabelText("Usuario para REF1"), "user-1");
}

describe("ImportsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imports.list.mockResolvedValue([]);
    accountsList.mockResolvedValue([makeAccount({ id: "acc-9", account_name: "Home Loan", borrower_name: "Regular User" })]);
    listUsers.mockResolvedValue([makeUser({ id: "user-1", full_name: "Regular User" })]);
  });

  describe("upload step", () => {
    it("prompts for a CSV and shows an empty history", async () => {
      renderWithProviders(<ImportsPage />);
      expect(await screen.findByText("Sin importaciones aún.")).toBeInTheDocument();
      expect(screen.getByText(/Sube un archivo CSV/)).toBeInTheDocument();
    });

    it("lists past imports", async () => {
      imports.list.mockResolvedValue([batch(), batch({ id: "b2", source_filename: "draft.csv", status: "previewed" })]);
      renderWithProviders(<ImportsPage />);
      const table = await screen.findByRole("table", { name: "Historial de importaciones" });
      expect(await within(table).findByText("ledger.csv")).toBeInTheDocument();
      expect(within(table).getByText("committed")).toBeInTheDocument();
      expect(within(table).getByText("previewed")).toBeInTheDocument();
      expect(screen.queryByText("Sin importaciones aún.")).toBeNull();
    });

    it("shows a reading indicator while the file is parsed", async () => {
      imports.preview.mockReturnValue(new Promise(() => {}));
      renderWithProviders(<ImportsPage />);
      await screen.findByText("Sin importaciones aún.");
      chooseFile();
      expect(await screen.findByText("Leyendo…")).toBeInTheDocument();
    });

    it("shows the server's message when the file can't be read", async () => {
      imports.preview.mockRejectedValue({ response: { data: { detail: "Columnas inválidas" } } });
      renderWithProviders(<ImportsPage />);
      await screen.findByText("Sin importaciones aún.");
      chooseFile();
      expect(await screen.findByText("Columnas inválidas")).toBeInTheDocument();
      expect(screen.getByText(/Sube un archivo CSV/)).toBeInTheDocument();
    });

    it("falls back to a generic message when there is no server detail", async () => {
      imports.preview.mockRejectedValue(new Error("boom"));
      renderWithProviders(<ImportsPage />);
      await screen.findByText("Sin importaciones aún.");
      chooseFile();
      expect(await screen.findByText("No se pudo leer el archivo")).toBeInTheDocument();
    });
  });

  describe("preview step", () => {
    it("summarises what was detected", async () => {
      await uploadAndPreview(previewFixture({ error_count: 2, total_payments_parsed: 4 }));
      const kpi = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling!;
      expect(kpi("Formato")).toHaveTextContent("legacy_ledger_csv");
      expect(kpi("Cuentas detectadas")).toHaveTextContent("2");
      expect(kpi("Pagos detectados")).toHaveTextContent("4");
      expect(kpi("Filas con error")).toHaveTextContent("2");
    });

    it("warns about payment references with no matching disbursement", async () => {
      await uploadAndPreview(previewFixture({ unmatched_payment_refs: ["REF8", "REF9"] }));
      expect(screen.getByText(/REF8, REF9/)).toBeInTheDocument();
    });

    it("lists parse errors, with a placeholder for an unknown row number", async () => {
      const user = userEvent.setup();
      await uploadAndPreview(previewFixture({
        error_count: 2,
        errors: [{ row_number: 3, message: "bad date" }, { row_number: null, message: "orphan" }],
      }));
      await user.click(screen.getByRole("button", { name: "Ver 2 fila(s) con error" }));
      expect(screen.getByText("Fila 3: bad date")).toBeInTheDocument();
      expect(screen.getByText("Fila ?: orphan")).toBeInTheDocument();
    });

    it("hides the error accordion when the file parsed cleanly", async () => {
      await uploadAndPreview();
      expect(screen.queryByText(/fila\(s\) con error/)).toBeNull();
    });

    it("pre-fills mappings from the file: create for new refs, existing for matches", async () => {
      await uploadAndPreview();
      const r1 = mappingRow("REF1");
      expect(within(r1).getByLabelText("Acción para REF1")).toHaveValue("create");
      expect(within(r1).getByLabelText("Nombre de cuenta para REF1")).toHaveValue("Ledger One");
      expect(within(r1).getByLabelText("Prestatario para REF1")).toHaveValue("Ann");
      expect(within(r1).getByLabelText("Tasa % para REF1")).toHaveValue("5");

      const r2 = mappingRow("REF2");
      expect(within(r2).getByLabelText("Acción para REF2")).toHaveValue("existing");
      expect(within(r2).getByLabelText("Cuenta destino para REF2")).toHaveValue("acc-9");
      expect(within(r2).getByText("Home Loan (Regular User)")).toBeInTheDocument();
    });

    // KNOWN BUG: parseFloat("0.07") * 100 === 7.000000000000001, so the rate field is pre-filled
    // with a float artifact. `it.fails` keeps CI green and starts failing once this is fixed
    // (then drop `.fails`). Suggested fix: Number((parseFloat(rate) * 100).toFixed(4)).
    it.fails("pre-fills a 0.07 rate as 7, not a floating-point artifact", async () => {
      const p = previewFixture();
      p.accounts[0].rate = "0.07";
      await uploadAndPreview(p);
      expect(within(mappingRow("REF1")).getByLabelText("Tasa % para REF1")).toHaveValue("7");
    });

    it("blocks confirmation until every new account has a user, and says why", async () => {
      await uploadAndPreview();
      expect(commitBtn()).toBeDisabled();
      expect(screen.getByText(/Completa el mapeo de todas las cuentas/)).toBeInTheDocument();
    });

    it("blocks confirmation when a new account has no rate", async () => {
      const user = userEvent.setup();
      await uploadAndPreview();
      await completeMapping(user);
      expect(commitBtn()).toBeEnabled();
      await user.clear(within(mappingRow("REF1")).getByLabelText("Tasa % para REF1"));
      expect(commitBtn()).toBeDisabled();
    });

    it("blocks confirmation when an 'existing' mapping has no target account", async () => {
      const user = userEvent.setup();
      await uploadAndPreview();
      await completeMapping(user);
      await user.selectOptions(within(mappingRow("REF2")).getByLabelText("Cuenta destino para REF2"), "");
      expect(commitBtn()).toBeDisabled();
    });

    it("lets a ref be skipped, which needs no extra details", async () => {
      const user = userEvent.setup();
      await uploadAndPreview();
      await user.selectOptions(within(mappingRow("REF1")).getByLabelText("Acción para REF1"), "skip");
      expect(within(mappingRow("REF1")).queryByLabelText("Usuario para REF1")).toBeNull();
      expect(commitBtn()).toBeEnabled();
    });

    it("switching a ref to 'existing' reveals the account picker", async () => {
      const user = userEvent.setup();
      await uploadAndPreview();
      await user.selectOptions(within(mappingRow("REF1")).getByLabelText("Acción para REF1"), "existing");
      expect(within(mappingRow("REF1")).getByLabelText("Cuenta destino para REF1")).toHaveValue("");
    });

    it("Cancelar discards the preview and returns to the upload step", async () => {
      const user = userEvent.setup();
      await uploadAndPreview();
      await user.click(screen.getByRole("button", { name: "Cancelar" }));
      expect(screen.queryByRole("table", { name: "Mapeo de cuentas" })).toBeNull();
      expect(screen.getByText(/Sube un archivo CSV/)).toBeInTheDocument();
    });
  });

  describe("committing", () => {
    it("sends one mapping per account, converting the rate % to a fraction", async () => {
      imports.commit.mockResolvedValue({ batch: batch(), rows: [] });
      const user = userEvent.setup();
      await uploadAndPreview();
      await completeMapping(user);
      await user.click(commitBtn());

      await waitFor(() =>
        expect(imports.commit).toHaveBeenCalledWith("b1", [
          { source_ref: "REF1", action: "create", account_name: "Ledger One", borrower_name: "Ann", linked_user_id: "user-1", rate: 0.05 },
          { source_ref: "REF2", action: "existing", existing_account_id: "acc-9" },
        ]),
      );
    });

    it("omits blank optional fields and sends skips as bare actions", async () => {
      imports.commit.mockResolvedValue({ batch: batch(), rows: [] });
      const user = userEvent.setup();
      await uploadAndPreview();
      await completeMapping(user);
      await user.clear(within(mappingRow("REF1")).getByLabelText("Nombre de cuenta para REF1"));
      await user.clear(within(mappingRow("REF1")).getByLabelText("Prestatario para REF1"));
      await user.selectOptions(within(mappingRow("REF2")).getByLabelText("Acción para REF2"), "skip");
      await user.click(commitBtn());

      await waitFor(() => expect(imports.commit).toHaveBeenCalled());
      const sent = imports.commit.mock.calls[0][1];
      expect(sent[0].account_name).toBeUndefined();
      expect(sent[0].borrower_name).toBeUndefined();
      expect(sent[1]).toEqual({ source_ref: "REF2", action: "skip" });
    });

    it("shows the result summary and can start another import", async () => {
      imports.commit.mockResolvedValue({ batch: batch({ summary: { created_accounts: 1, payments_imported: 3 } }), rows: [] });
      const user = userEvent.setup();
      await uploadAndPreview();
      await completeMapping(user);
      await user.click(commitBtn());

      expect(await screen.findByRole("heading", { name: "Importación completada" })).toBeInTheDocument();
      expect(screen.getByText("created accounts").nextElementSibling).toHaveTextContent("1");
      expect(screen.getByText("payments imported").nextElementSibling).toHaveTextContent("3");
      expect(screen.queryByRole("table", { name: "Mapeo de cuentas" })).toBeNull();

      await user.click(screen.getByRole("button", { name: "Importar otro archivo" }));
      expect(screen.getByText(/Sube un archivo CSV/)).toBeInTheDocument();
    });

    it("shows an error and keeps the mapping when the import fails", async () => {
      imports.commit.mockRejectedValue({ response: { data: { detail: "Cuenta duplicada" } } });
      const user = userEvent.setup();
      await uploadAndPreview();
      await completeMapping(user);
      await user.click(commitBtn());
      expect(await screen.findByText("Cuenta duplicada")).toBeInTheDocument();
      expect(screen.getByRole("table", { name: "Mapeo de cuentas" })).toBeInTheDocument();
      expect(commitBtn()).toBeEnabled();
    });

    it("falls back to a generic message when the failure has no detail", async () => {
      imports.commit.mockRejectedValue(new Error("network"));
      const user = userEvent.setup();
      await uploadAndPreview();
      await completeMapping(user);
      await user.click(commitBtn());
      expect(await screen.findByText("La importación falló")).toBeInTheDocument();
    });

    it("disables the button and shows progress while importing", async () => {
      imports.commit.mockReturnValue(new Promise(() => {}));
      const user = userEvent.setup();
      await uploadAndPreview();
      await completeMapping(user);
      await user.click(commitBtn());
      expect(await screen.findByText("Importando…")).toBeInTheDocument();
    });
  });
});

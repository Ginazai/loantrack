import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentAttachmentsModal } from "./PaymentAttachments";
import { attachmentsApi } from "../../api";
import { makeAttachment } from "../../test/factories";
import { renderWithProviders } from "../../test/utils";

vi.mock("../../api", () => ({
  attachmentsApi: { list: vi.fn(), upload: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));
const api = attachmentsApi as unknown as Record<"list" | "upload" | "delete" | "download", ReturnType<typeof vi.fn>>;

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const pick = (file: File) => fireEvent.change(fileInput(), { target: { files: [file] } });
const render = (isAdmin = true, onClose = vi.fn()) =>
  renderWithProviders(<PaymentAttachmentsModal accountId="acc-1" paymentId="pay-1" isAdmin={isAdmin} onClose={onClose} />);

describe("PaymentAttachmentsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue([]);
    api.upload.mockResolvedValue(makeAttachment());
    api.delete.mockResolvedValue({});
  });

  it("shows a skeleton while loading", () => {
    api.list.mockReturnValue(new Promise(() => {}));
    render();
    expect(screen.queryByText("Sin comprobantes adjuntos.")).toBeNull();
  });

  it("shows the empty state when there are no receipts", async () => {
    render();
    expect(await screen.findByText("Sin comprobantes adjuntos.")).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledWith("acc-1", "pay-1");
  });

  it("lists receipts with human-readable sizes", async () => {
    api.list.mockResolvedValue([
      makeAttachment({ id: "1", original_filename: "tiny.png", size_bytes: 500 }),
      makeAttachment({ id: "2", original_filename: "mid.pdf", size_bytes: 2048 }),
      makeAttachment({ id: "3", original_filename: "big.jpg", size_bytes: 5 * 1024 * 1024 }),
    ]);
    render();
    expect(await screen.findByText(/500 B/)).toBeInTheDocument();
    expect(screen.getByText(/2 KB/)).toBeInTheDocument();
    expect(screen.getByText(/5\.0 MB/)).toBeInTheDocument();
  });

  it("downloads a receipt", async () => {
    api.list.mockResolvedValue([makeAttachment({ id: "att-9", original_filename: "r.pdf" })]);
    render();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Descargar" }));
    expect(api.download).toHaveBeenCalledWith("acc-1", "pay-1", "att-9", "r.pdf");
  });

  it("lets admins delete a receipt", async () => {
    api.list.mockResolvedValue([makeAttachment({ id: "att-9" })]);
    render(true);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(api.delete).toHaveBeenCalled());
    expect(api.delete.mock.calls[0].slice(0, 3)).toEqual(["acc-1", "pay-1", "att-9"]);
  });

  it("hides delete from non-admins", async () => {
    api.list.mockResolvedValue([makeAttachment()]);
    render(false);
    await screen.findByText("receipt.pdf");
    expect(screen.queryByRole("button", { name: "Eliminar" })).toBeNull();
  });

  describe("uploading", () => {
    it("opens the file picker from the upload button", async () => {
      const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
      render();
      await userEvent.setup().click(await screen.findByRole("button", { name: "Subir comprobante" }));
      expect(click).toHaveBeenCalled();
      click.mockRestore();
    });

    it("uploads an allowed file", async () => {
      render();
      await screen.findByText("Sin comprobantes adjuntos.");
      const file = new File(["x"], "r.png", { type: "image/png" });
      pick(file);
      await waitFor(() => expect(api.upload).toHaveBeenCalled());
      expect(api.upload.mock.calls[0]).toEqual(["acc-1", "pay-1", file]);
    });

    it("rejects a disallowed file type without calling the API", async () => {
      render();
      await screen.findByText("Sin comprobantes adjuntos.");
      pick(new File(["x"], "notes.txt", { type: "text/plain" }));
      expect(await screen.findByText(/Tipo de archivo no permitido/)).toBeInTheDocument();
      expect(api.upload).not.toHaveBeenCalled();
    });

    it("rejects a file over 10 MB without calling the API", async () => {
      render();
      await screen.findByText("Sin comprobantes adjuntos.");
      const big = new File(["x"], "big.pdf", { type: "application/pdf" });
      Object.defineProperty(big, "size", { value: 10 * 1024 * 1024 + 1 });
      pick(big);
      expect(await screen.findByText("El archivo supera el límite de 10 MB.")).toBeInTheDocument();
      expect(api.upload).not.toHaveBeenCalled();
    });

    it("accepts a file of exactly 10 MB", async () => {
      render();
      await screen.findByText("Sin comprobantes adjuntos.");
      const edge = new File(["x"], "edge.pdf", { type: "application/pdf" });
      Object.defineProperty(edge, "size", { value: 10 * 1024 * 1024 });
      pick(edge);
      await waitFor(() => expect(api.upload).toHaveBeenCalled());
    });

    it("ignores an empty selection", async () => {
      render();
      await screen.findByText("Sin comprobantes adjuntos.");
      fireEvent.change(fileInput(), { target: { files: [] } });
      expect(api.upload).not.toHaveBeenCalled();
    });

    it("shows the server's message when the upload fails", async () => {
      api.upload.mockRejectedValue({ response: { data: { detail: "Almacenamiento lleno" } } });
      render();
      await screen.findByText("Sin comprobantes adjuntos.");
      pick(new File(["x"], "r.png", { type: "image/png" }));
      expect(await screen.findByText("Almacenamiento lleno")).toBeInTheDocument();
    });

    it("refreshes the list after a successful upload", async () => {
      render();
      await screen.findByText("Sin comprobantes adjuntos.");
      pick(new File(["x"], "r.png", { type: "image/png" }));
      await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    });
  });

  it("calls onClose from the drawer's close button", async () => {
    const onClose = vi.fn();
    render(true, onClose);
    await screen.findByText("Sin comprobantes adjuntos.");
    await userEvent.setup().click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

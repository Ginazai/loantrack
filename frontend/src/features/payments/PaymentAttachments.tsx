import { Download, Loader2, Paperclip, Trash2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { attachmentsApi } from "../../api";
import { formatDate } from "../../utils/dateUtils";

// jpg/png/webp/pdf, 10 MB max — mirrors the backend limit (ADR-005 /
// payments/schemas.py::validate_attachment). Enforced again server-side;
// this is just a fast, friendly rejection before the upload even starts.
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  accountId: string;
  paymentId: string;
  isAdmin: boolean;
  onClose: () => void;
}

export function PaymentAttachmentsModal({ accountId, paymentId, isAdmin, onClose }: Props) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: attachments = [], isLoading } = useQuery({
    queryKey: ["payment-attachments", accountId, paymentId],
    queryFn: () => attachmentsApi.list(accountId, paymentId),
  });

  const upload = useMutation({
    mutationFn: (file: File) => attachmentsApi.upload(accountId, paymentId, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payment-attachments", accountId, paymentId] });
      qc.invalidateQueries({ queryKey: ["payments", accountId] }); // refresh attachment_count badge
      setError(null);
    },
    onError: (err: any) => setError(err?.response?.data?.detail ?? "Upload failed"),
  });

  const remove = useMutation({
    mutationFn: (attachmentId: string) => attachmentsApi.delete(accountId, paymentId, attachmentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payment-attachments", accountId, paymentId] });
      qc.invalidateQueries({ queryKey: ["payments", accountId] });
    },
  });

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError(`Tipo de archivo no permitido. Permitidos: jpg, png, webp, pdf.`);
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError("El archivo supera el límite de 10 MB.");
      return;
    }
    upload.mutate(file);
  };

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Paperclip className="w-4 h-4" /> Comprobantes
          </h2>
          <button className="btn btn-ghost btn-xs btn-circle" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {isLoading ? (
          <p className="text-sm text-base-content/50">Cargando…</p>
        ) : attachments.length === 0 ? (
          <p className="text-sm text-base-content/50 mb-4">Sin comprobantes adjuntos.</p>
        ) : (
          <ul className="divide-y divide-base-200 mb-4">
            {attachments.map((a) => (
              <li key={a.id} className="py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{a.original_filename}</p>
                  <p className="text-xs text-base-content/50">
                    {formatSize(a.size_bytes)} · {formatDate(a.created_at)}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    className="btn btn-ghost btn-xs btn-circle"
                    title="Descargar"
                    onClick={() => attachmentsApi.download(accountId, paymentId, a.id, a.original_filename)}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  {isAdmin && (
                    <button
                      className="btn btn-ghost btn-xs btn-circle text-error"
                      title="Eliminar"
                      onClick={() => remove.mutate(a.id)}
                      disabled={remove.isPending}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <div className="alert alert-error text-sm py-2 mb-3">
            <span>{error}</span>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <button
          className="btn btn-outline btn-sm w-full gap-2"
          onClick={() => fileInputRef.current?.click()}
          disabled={upload.isPending}
        >
          {upload.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Upload className="w-4 h-4" />
          )}
          Subir comprobante
        </button>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  );
}

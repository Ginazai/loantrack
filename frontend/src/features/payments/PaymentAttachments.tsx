import { Document, Download, TrashCan, Upload } from "@carbon/icons-react";
import { Button, InlineLoading, SkeletonText } from "@carbon/react";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { attachmentsApi } from "../../api";
import { formatDate } from "../../utils/dateUtils";
import { getApiErrorMessage } from "../../utils/apiError";
import { Drawer, EmptyState, Notice } from "../../components/common";

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
    onError: (err: any) => setError(getApiErrorMessage(err, "Upload failed")),
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
      setError(`File type not allowed. Allowed: jpg, png, webp, pdf.`);
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError("The file exceeds the 10 MB limit.");
      return;
    }
    upload.mutate(file);
  };

  return (
    <Drawer title="Comprobantes" onClose={onClose}>
      <div className="lt-stack">
        {isLoading ? (
          <SkeletonText paragraph lineCount={3} />
        ) : attachments.length === 0 ? (
          <EmptyState Icon={Document} title="No receipts attached." />
        ) : (
          <ul className="lt-link-list lt-attachments">
            {attachments.map((a) => (
              <li key={a.id}>
                <div className="lt-attachment">
                  <div className="lt-attachment__text">
                    <div className="lt-link-list__name lt-truncate">{a.original_filename}</div>
                    <div className="lt-link-list__sub">
                      {formatSize(a.size_bytes)} · {formatDate(a.created_at)}
                    </div>
                  </div>
                  <div className="lt-table-actions">
                    <Button
                      kind="ghost"
                      size="md"
                      hasIconOnly
                      renderIcon={Download}
                      iconDescription="Download"
                      tooltipPosition="left"
                      onClick={() => attachmentsApi.download(accountId, paymentId, a.id, a.original_filename)}
                    />
                    {isAdmin && (
                      <Button
                        kind="danger--ghost"
                        size="md"
                        hasIconOnly
                        renderIcon={TrashCan}
                        iconDescription="Delete"
                        tooltipPosition="left"
                        onClick={() => remove.mutate(a.id)}
                        disabled={remove.isPending}
                      />
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {error && <Notice kind="error">{error}</Notice>}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="lt-visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = ""; // allow re-selecting the same file after an error
          }}
        />
        <Button
          kind="tertiary"
          className="lt-fit"
          renderIcon={upload.isPending ? undefined : Upload}
          onClick={() => fileInputRef.current?.click()}
          disabled={upload.isPending}
        >
          {upload.isPending ? <InlineLoading description="Uploading…" /> : "Upload receipt"}
        </Button>
        <p className="lt-field-note">JPG, PNG, WebP or PDF · max 10 MB</p>
      </div>
    </Drawer>
  );
}

import { CheckmarkFilled, DocumentImport, Time } from "@carbon/icons-react";
import {
  Accordion,
  AccordionItem,
  Button,
  FileUploaderDropContainer,
  InlineLoading,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  TextInput,
} from "@carbon/react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { accountsApi, adminApi, importsApi } from "../../api";
import { Notice, PageHeader } from "../../components/common";
import { getApiErrorMessage } from "../../utils/apiError";
import type {
  AccountMapping,
  ImportAction,
  ImportCommitResult,
  ImportPreview,
} from "../../types";

// Mirrors backend defaults (ADR-004 / requirements doc, section 6):
// admin fills in whatever the source file can't carry — owning user,
// borrower name, rate — there's no auto-guessing beyond a suggestion.
interface RowMappingState {
  action: ImportAction;
  existing_account_id: string;
  account_name: string;
  borrower_name: string;
  linked_user_id: string;
  rate_percent: string;
}

export default function ImportsPage() {
  // Bumping the key remounts the drop container so the same file can be picked again after a reset.
  const [uploaderKey, setUploaderKey] = useState(0);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mappings, setMappings] = useState<Record<string, RowMappingState>>({});
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<ImportCommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => adminApi.listUsers(),
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts", "all-for-import"],
    queryFn: () => accountsApi.list(),
  });
  const { data: history = [] } = useQuery({
    queryKey: ["import-batches"],
    queryFn: () => importsApi.list(),
  });

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setPreviewing(true);
    setError(null);
    setResult(null);
    try {
      const p = await importsApi.preview(file);
      setPreview(p);
      const initial: Record<string, RowMappingState> = {};
      for (const acc of p.accounts) {
        initial[acc.source_ref] = {
          action: acc.suggested_existing_account_id ? "existing" : "create",
          existing_account_id: acc.suggested_existing_account_id ?? "",
          account_name: acc.suggested_account_name,
          borrower_name: acc.borrower_name ?? "",
          linked_user_id: "",
          rate_percent: acc.rate ? String(parseFloat(acc.rate) * 100) : "",
        };
      }
      setMappings(initial);
    } catch (e: any) {
      setError(getApiErrorMessage(e, "Could not read the file"));
    } finally {
      setPreviewing(false);
    }
  };

  const updateMapping = (ref: string, patch: Partial<RowMappingState>) =>
    setMappings((m) => ({ ...m, [ref]: { ...m[ref], ...patch } }));

  const handleCommit = async () => {
    if (!preview) return;
    setCommitting(true);
    setError(null);
    try {
      const payload: AccountMapping[] = preview.accounts.map((acc) => {
        const m = mappings[acc.source_ref];
        const base: AccountMapping = { source_ref: acc.source_ref, action: m.action };
        if (m.action === "existing") base.existing_account_id = m.existing_account_id || undefined;
        if (m.action === "create") {
          base.account_name = m.account_name || undefined;
          base.borrower_name = m.borrower_name || undefined;
          base.linked_user_id = m.linked_user_id || undefined;
          base.rate = m.rate_percent ? parseFloat(m.rate_percent) / 100 : undefined;
        }
        return base;
      });
      const res = await importsApi.commit(preview.batch_id, payload);
      setResult(res);
    } catch (e: any) {
      setError(getApiErrorMessage(e, "Import failed"));
    } finally {
      setCommitting(false);
    }
  };

  const reset = () => {
    setPreview(null);
    setMappings({});
    setResult(null);
    setError(null);
    setUploaderKey((k) => k + 1);
  };

  const readyToCommit =
    preview !== null &&
    preview.accounts.every((acc) => {
      const m = mappings[acc.source_ref];
      if (!m) return false;
      if (m.action === "existing") return !!m.existing_account_id;
      if (m.action === "create") return !!m.linked_user_id && !!m.rate_percent;
      return true; // skip
    });

  return (
    <div className="lt-page lt-stack lt-stack--loose">
      <PageHeader
        title="Import data"
        subtitle="Native CSV (round-trip) or external ledger export (Reference/Date/Description/Debit/Credit)"
      />

      {!preview && !result && (
        <section className="lt-panel lt-panel__body lt-stack">
          <p className="lt-muted">
            Upload a CSV file. The system automatically detects whether it is a native LoanTrack export or a ledger-format file.
          </p>
          {previewing ? (
            <InlineLoading description="Reading…" />
          ) : (
            <FileUploaderDropContainer
              key={uploaderKey}
              accept={[".csv", "text/csv"]}
              labelText="Drag a CSV file here or click to select it"
              name="import-file"
              multiple={false}
              onAddFiles={(_e: unknown, { addedFiles }: { addedFiles: File[] }) => handleFile(addedFiles[0])}
            />
          )}
          {error && <Notice kind="error">{error}</Notice>}
        </section>
      )}

      {preview && !result && (
        <div className="lt-stack">
          <dl className="lt-kpis lt-kpis--compact">
            {[
              ["Format", preview.format],
              ["Accounts detected", preview.accounts.length],
              ["Payments detected", preview.total_payments_parsed],
              ["Rows with errors", preview.error_count],
            ].map(([k, v]) => (
              <div key={String(k)} className="lt-kpi">
                <dt className="lt-kpi__label">{k}</dt>
                <dd className="lt-kpi__value">{v}</dd>
              </div>
            ))}
          </dl>

          {preview.unmatched_payment_refs.length > 0 && (
            <Notice kind="warning" title="References without disbursement">
              References with payments but no disbursement in the file (they must be mapped to an existing account): {preview.unmatched_payment_refs.join(", ")}
            </Notice>
          )}

          {preview.errors.length > 0 && (
            <Accordion>
              <AccordionItem title={`View ${preview.errors.length} row(s) with errors`}>
                <ul className="lt-stack lt-stack--tight">
                  {preview.errors.map((e, i) => (
                    <li key={i} className="lt-muted">
                      Row {e.row_number ?? "?"}: {e.message}
                    </li>
                  ))}
                </ul>
              </AccordionItem>
            </Accordion>
          )}

          <div className="lt-panel">
            <div className="lt-table-wrap">
              <Table size="lg" aria-label="Account mapping">
                <TableHead>
                  <TableRow>
                    <TableHeader>Ref.</TableHeader>
                    <TableHeader>Amount / Date</TableHeader>
                    <TableHeader className="lt-num">Payments</TableHeader>
                    <TableHeader>Action</TableHeader>
                    <TableHeader>Details</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {preview.accounts.map((acc) => {
                    const m = mappings[acc.source_ref];
                    if (!m) return null;
                    const k = acc.source_ref;
                    return (
                      <TableRow key={k}>
                        <TableCell><span className="lt-mono">{k}</span></TableCell>
                        <TableCell>
                          <span className="lt-num">{acc.borrow_amount}</span> · {acc.start_date}
                        </TableCell>
                        <TableCell className="lt-num">{acc.payment_count}</TableCell>
                        <TableCell>
                          <Select
                            id={`action-${k}`}
                            size="sm"
                            hideLabel
                            labelText={`Action for ${k}`}
                            value={m.action}
                            onChange={(e) => updateMapping(k, { action: e.target.value as ImportAction })}
                          >
                            <SelectItem value="create" text="Create account" />
                            <SelectItem value="existing" text="Existing account" />
                            <SelectItem value="skip" text="Skip" />
                          </Select>
                        </TableCell>
                        <TableCell>
                          {m.action === "existing" && (
                            <Select
                              id={`existing-${k}`}
                              size="sm"
                              hideLabel
                              labelText={`Target account for ${k}`}
                              value={m.existing_account_id}
                              onChange={(e) => updateMapping(k, { existing_account_id: e.target.value })}
                            >
                              <SelectItem value="" text="— Choose account —" />
                              {accounts.map((a) => (
                                <SelectItem key={a.id} value={a.id} text={`${a.account_name} (${a.borrower_name})`} />
                              ))}
                            </Select>
                          )}
                          {m.action === "create" && (
                            <div className="lt-import-fields">
                              <TextInput
                                id={`name-${k}`}
                                size="sm"
                                hideLabel
                                labelText={`Account name for ${k}`}
                                placeholder="Account name"
                                value={m.account_name}
                                onChange={(e) => updateMapping(k, { account_name: e.target.value })}
                              />
                              <TextInput
                                id={`borrower-${k}`}
                                size="sm"
                                hideLabel
                                labelText={`Borrower for ${k}`}
                                placeholder="Borrower"
                                value={m.borrower_name}
                                onChange={(e) => updateMapping(k, { borrower_name: e.target.value })}
                              />
                              <Select
                                id={`user-${k}`}
                                size="sm"
                                hideLabel
                                labelText={`User for ${k}`}
                                value={m.linked_user_id}
                                onChange={(e) => updateMapping(k, { linked_user_id: e.target.value })}
                              >
                                <SelectItem value="" text="User…" />
                                {users.map((u) => (
                                  <SelectItem key={u.id} value={u.id} text={u.full_name} />
                                ))}
                              </Select>
                              <TextInput
                                id={`rate-${k}`}
                                size="sm"
                                hideLabel
                                labelText={`Rate % for ${k}`}
                                placeholder="Rate %"
                                value={m.rate_percent}
                                onChange={(e) => updateMapping(k, { rate_percent: e.target.value })}
                              />
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          {!readyToCommit && (
            <Notice kind="warning">
              Complete the mapping for every account (user and rate for new ones, target account for existing ones) before confirming.
            </Notice>
          )}
          {error && <Notice kind="error">{error}</Notice>}

          <div className="lt-row lt-row--end lt-row--flush">
            <Button kind="secondary" size="lg" onClick={reset}>Cancel</Button>
            <Button size="lg" disabled={!readyToCommit || committing} onClick={handleCommit}>
              {committing ? <InlineLoading description="Importing…" /> : "Confirm import"}
            </Button>
          </div>
        </div>
      )}

      {result && (
        <section className="lt-panel lt-panel--success lt-panel__body lt-stack">
          <div className="lt-row">
            <CheckmarkFilled size={20} className="lt-success-icon" aria-hidden="true" />
            <h2 className="lt-section-title lt-section-title--flush">Import complete</h2>
          </div>
          <dl className="lt-kpis lt-kpis--auto lt-kpis--compact">
            {Object.entries(result.batch.summary).map(([k, v]) => (
              <div key={k} className="lt-kpi">
                <dt className="lt-kpi__label">{k.replace(/_/g, " ")}</dt>
                <dd className="lt-kpi__value">{v as React.ReactNode}</dd>
              </div>
            ))}
          </dl>
          <div>
            <Button kind="tertiary" onClick={reset}>Import another file</Button>
          </div>
        </section>
      )}

      <section className="lt-panel" aria-labelledby="history-heading">
        <div className="lt-panel__header">
          <h2 className="lt-panel__title" id="history-heading">
            <Time size={20} aria-hidden="true" /> Import history
          </h2>
        </div>
        <div className="lt-table-wrap">
          <Table size="lg" aria-label="Import history">
            <TableHead>
              <TableRow>
                <TableHeader>File</TableHeader>
                <TableHeader>Format</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Date</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {history.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>{b.source_filename}</TableCell>
                  <TableCell>{b.format}</TableCell>
                  <TableCell>
                    <Tag size="sm" type={b.status === "committed" ? "green" : "gray"}>
                      {b.status}
                    </Tag>
                  </TableCell>
                  <TableCell className="lt-tnum">
                    {new Date(b.created_at).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {history.length === 0 && (
            <p className="lt-muted lt-empty-row">No imports yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

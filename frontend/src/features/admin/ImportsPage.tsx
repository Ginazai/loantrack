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
      setError(getApiErrorMessage(e, "No se pudo leer el archivo"));
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
      setError(getApiErrorMessage(e, "La importación falló"));
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
    <div className="lt-page lt-page--medium lt-stack lt-stack--loose">
      <PageHeader
        title="Importar datos"
        subtitle="CSV nativo (round-trip) o libro contable externo (Referencia/Fecha/Descripcion/Debito/Credito)"
      />

      {!preview && !result && (
        <section className="lt-panel lt-panel__body lt-stack">
          <p className="lt-muted">
            Sube un archivo CSV. El sistema detecta automáticamente si es una
            exportación nativa de LoanTrack o el formato de libro contable.
          </p>
          {previewing ? (
            <InlineLoading description="Leyendo…" />
          ) : (
            <FileUploaderDropContainer
              key={uploaderKey}
              accept={[".csv", "text/csv"]}
              labelText="Arrastra un archivo CSV aquí o haz clic para seleccionarlo"
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
          <dl className="lt-kpis lt-kpis--3" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            {[
              ["Formato", preview.format],
              ["Cuentas detectadas", preview.accounts.length],
              ["Pagos detectados", preview.total_payments_parsed],
              ["Filas con error", preview.error_count],
            ].map(([k, v]) => (
              <div key={String(k)} className="lt-kpi" style={{ minBlockSize: 0, gap: "0.5rem" }}>
                <dt className="lt-kpi__label">{k}</dt>
                <dd className="lt-kpi__value" style={{ margin: 0 }}>{v}</dd>
              </div>
            ))}
          </dl>

          {preview.unmatched_payment_refs.length > 0 && (
            <Notice kind="warning" title="Referencias sin desembolso">
              Referencias con pagos pero sin desembolso en el archivo (deben
              mapearse a una cuenta existente): {preview.unmatched_payment_refs.join(", ")}
            </Notice>
          )}

          {preview.errors.length > 0 && (
            <Accordion>
              <AccordionItem title={`Ver ${preview.errors.length} fila(s) con error`}>
                <ul className="lt-stack lt-stack--tight">
                  {preview.errors.map((e, i) => (
                    <li key={i} className="lt-muted">
                      Fila {e.row_number ?? "?"}: {e.message}
                    </li>
                  ))}
                </ul>
              </AccordionItem>
            </Accordion>
          )}

          <div className="lt-panel">
            <div className="lt-table-wrap">
              <Table size="lg" aria-label="Mapeo de cuentas">
                <TableHead>
                  <TableRow>
                    <TableHeader>Ref.</TableHeader>
                    <TableHeader>Monto / Fecha</TableHeader>
                    <TableHeader className="lt-num">Pagos</TableHeader>
                    <TableHeader>Acción</TableHeader>
                    <TableHeader>Detalle</TableHeader>
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
                            labelText={`Acción para ${k}`}
                            value={m.action}
                            onChange={(e) => updateMapping(k, { action: e.target.value as ImportAction })}
                          >
                            <SelectItem value="create" text="Crear cuenta" />
                            <SelectItem value="existing" text="Cuenta existente" />
                            <SelectItem value="skip" text="Omitir" />
                          </Select>
                        </TableCell>
                        <TableCell>
                          {m.action === "existing" && (
                            <Select
                              id={`existing-${k}`}
                              size="sm"
                              hideLabel
                              labelText={`Cuenta destino para ${k}`}
                              value={m.existing_account_id}
                              onChange={(e) => updateMapping(k, { existing_account_id: e.target.value })}
                            >
                              <SelectItem value="" text="— Elegir cuenta —" />
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
                                labelText={`Nombre de cuenta para ${k}`}
                                placeholder="Nombre cuenta"
                                value={m.account_name}
                                onChange={(e) => updateMapping(k, { account_name: e.target.value })}
                              />
                              <TextInput
                                id={`borrower-${k}`}
                                size="sm"
                                hideLabel
                                labelText={`Prestatario para ${k}`}
                                placeholder="Prestatario"
                                value={m.borrower_name}
                                onChange={(e) => updateMapping(k, { borrower_name: e.target.value })}
                              />
                              <Select
                                id={`user-${k}`}
                                size="sm"
                                hideLabel
                                labelText={`Usuario para ${k}`}
                                value={m.linked_user_id}
                                onChange={(e) => updateMapping(k, { linked_user_id: e.target.value })}
                              >
                                <SelectItem value="" text="Usuario…" />
                                {users.map((u) => (
                                  <SelectItem key={u.id} value={u.id} text={u.full_name} />
                                ))}
                              </Select>
                              <TextInput
                                id={`rate-${k}`}
                                size="sm"
                                hideLabel
                                labelText={`Tasa % para ${k}`}
                                placeholder="Tasa %"
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
              Completa el mapeo de todas las cuentas (usuario y tasa para las nuevas,
              cuenta destino para las existentes) antes de confirmar.
            </Notice>
          )}
          {error && <Notice kind="error">{error}</Notice>}

          <div className="lt-row" style={{ justifyContent: "flex-end", gap: 0 }}>
            <Button kind="secondary" onClick={reset}>Cancelar</Button>
            <Button disabled={!readyToCommit || committing} onClick={handleCommit}>
              {committing ? <InlineLoading description="Importando…" /> : "Confirmar importación"}
            </Button>
          </div>
        </div>
      )}

      {result && (
        <section className="lt-panel lt-panel--success lt-panel__body lt-stack">
          <div className="lt-row">
            <CheckmarkFilled size={20} className="lt-success-icon" aria-hidden="true" />
            <h2 className="lt-section-title" style={{ margin: 0 }}>Importación completada</h2>
          </div>
          <dl className="lt-kpis" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))" }}>
            {Object.entries(result.batch.summary).map(([k, v]) => (
              <div key={k} className="lt-kpi" style={{ minBlockSize: 0, gap: "0.5rem" }}>
                <dt className="lt-kpi__label">{k.replace(/_/g, " ")}</dt>
                <dd className="lt-kpi__value" style={{ margin: 0 }}>{v as React.ReactNode}</dd>
              </div>
            ))}
          </dl>
          <div>
            <Button kind="tertiary" onClick={reset}>Importar otro archivo</Button>
          </div>
        </section>
      )}

      <section className="lt-panel" aria-labelledby="history-heading">
        <div className="lt-panel__header">
          <h2 className="lt-panel__title" id="history-heading">
            <Time size={20} aria-hidden="true" /> Historial de importaciones
          </h2>
        </div>
        <div className="lt-table-wrap">
          <Table size="lg" aria-label="Historial de importaciones">
            <TableHead>
              <TableRow>
                <TableHeader>Archivo</TableHeader>
                <TableHeader>Formato</TableHeader>
                <TableHeader>Estado</TableHeader>
                <TableHeader>Fecha</TableHeader>
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
            <p className="lt-muted lt-empty-row">Sin importaciones aún.</p>
          )}
        </div>
      </section>
    </div>
  );
}

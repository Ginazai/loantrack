import { AlertTriangle, CheckCircle2, FileUp, History, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { accountsApi, adminApi, importsApi } from "../../api";
import { PageHeader } from "../../components/common";
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
  const fileInputRef = useRef<HTMLInputElement>(null);
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
      setError(e?.response?.data?.detail ?? "No se pudo leer el archivo");
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
      setError(e?.response?.data?.detail ?? "La importación falló");
    } finally {
      setCommitting(false);
    }
  };

  const reset = () => {
    setPreview(null);
    setMappings({});
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
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
    <div className="space-y-6">
      <PageHeader
        title="Importar datos"
        subtitle="CSV nativo (round-trip) o libro contable externo (Referencia/Fecha/Descripcion/Debito/Credito)"
      />

      {!preview && !result && (
        <div className="bg-base-100 border border-base-300 rounded-xl p-8 text-center">
          <FileUp className="w-10 h-10 mx-auto text-base-content/30 mb-3" />
          <p className="text-sm text-base-content/60 mb-4">
            Sube un archivo CSV. El sistema detecta automáticamente si es una
            exportación nativa de LoanTrack o el formato de libro contable.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <button
            className="btn btn-primary btn-sm gap-2"
            onClick={() => fileInputRef.current?.click()}
            disabled={previewing}
          >
            {previewing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Leyendo…
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Seleccionar archivo
              </>
            )}
          </button>
          {error && <p className="text-error text-sm mt-3">{error}</p>}
        </div>
      )}

      {preview && !result && (
        <div className="space-y-4">
          <div className="bg-base-200 rounded-xl p-4 text-sm flex flex-wrap gap-x-6 gap-y-1">
            <span><strong>Formato:</strong> {preview.format}</span>
            <span><strong>Cuentas detectadas:</strong> {preview.accounts.length}</span>
            <span><strong>Pagos detectados:</strong> {preview.total_payments_parsed}</span>
            <span className={preview.error_count > 0 ? "text-warning" : ""}>
              <strong>Filas con error:</strong> {preview.error_count}
            </span>
          </div>

          {preview.unmatched_payment_refs.length > 0 && (
            <div className="alert alert-warning text-sm">
              <AlertTriangle className="w-4 h-4" />
              <span>
                Referencias con pagos pero sin desembolso en el archivo (deben
                mapearse a una cuenta existente):{" "}
                {preview.unmatched_payment_refs.join(", ")}
              </span>
            </div>
          )}

          {preview.errors.length > 0 && (
            <details className="bg-base-100 border border-base-300 rounded-xl p-3 text-xs">
              <summary className="cursor-pointer font-medium">
                Ver {preview.errors.length} fila(s) con error
              </summary>
              <ul className="mt-2 space-y-1 text-base-content/60">
                {preview.errors.map((e, i) => (
                  <li key={i}>
                    Fila {e.row_number ?? "?"}: {e.message}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="overflow-x-auto bg-base-100 border border-base-300 rounded-xl">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Ref.</th>
                  <th>Monto / Fecha</th>
                  <th>Pagos</th>
                  <th>Acción</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {preview.accounts.map((acc) => {
                  const m = mappings[acc.source_ref];
                  if (!m) return null;
                  return (
                    <tr key={acc.source_ref}>
                      <td className="font-mono text-xs">{acc.source_ref}</td>
                      <td className="text-xs">
                        {acc.borrow_amount} · {acc.start_date}
                      </td>
                      <td className="text-xs">{acc.payment_count}</td>
                      <td>
                        <select
                          className="select select-bordered select-xs"
                          value={m.action}
                          onChange={(e) =>
                            updateMapping(acc.source_ref, {
                              action: e.target.value as ImportAction,
                            })
                          }
                        >
                          <option value="create">Crear cuenta</option>
                          <option value="existing">Cuenta existente</option>
                          <option value="skip">Omitir</option>
                        </select>
                      </td>
                      <td>
                        {m.action === "existing" && (
                          <select
                            className="select select-bordered select-xs w-full"
                            value={m.existing_account_id}
                            onChange={(e) =>
                              updateMapping(acc.source_ref, { existing_account_id: e.target.value })
                            }
                          >
                            <option value="">— Elegir cuenta —</option>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.account_name} ({a.borrower_name})
                              </option>
                            ))}
                          </select>
                        )}
                        {m.action === "create" && (
                          <div className="flex flex-wrap gap-1">
                            <input
                              className="input input-bordered input-xs w-32"
                              placeholder="Nombre cuenta"
                              value={m.account_name}
                              onChange={(e) => updateMapping(acc.source_ref, { account_name: e.target.value })}
                            />
                            <input
                              className="input input-bordered input-xs w-28"
                              placeholder="Prestatario"
                              value={m.borrower_name}
                              onChange={(e) => updateMapping(acc.source_ref, { borrower_name: e.target.value })}
                            />
                            <select
                              className="select select-bordered select-xs w-28"
                              value={m.linked_user_id}
                              onChange={(e) => updateMapping(acc.source_ref, { linked_user_id: e.target.value })}
                            >
                              <option value="">Usuario…</option>
                              {users.map((u) => (
                                <option key={u.id} value={u.id}>{u.full_name}</option>
                              ))}
                            </select>
                            <input
                              className="input input-bordered input-xs w-16"
                              placeholder="Tasa %"
                              value={m.rate_percent}
                              onChange={(e) => updateMapping(acc.source_ref, { rate_percent: e.target.value })}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!readyToCommit && (
            <p className="text-xs text-warning">
              Completa el mapeo de todas las cuentas (usuario y tasa para las nuevas,
              cuenta destino para las existentes) antes de confirmar.
            </p>
          )}
          {error && <p className="text-error text-sm">{error}</p>}

          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost btn-sm" onClick={reset}>Cancelar</button>
            <button
              className="btn btn-primary btn-sm gap-2"
              disabled={!readyToCommit || committing}
              onClick={handleCommit}
            >
              {committing && <Loader2 className="w-4 h-4 animate-spin" />}
              Confirmar importación
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="bg-base-100 border border-base-300 rounded-xl p-6 space-y-3">
          <div className="flex items-center gap-2 text-success">
            <CheckCircle2 className="w-5 h-5" />
            <span className="font-semibold">Importación completada</span>
          </div>
          <div className="text-sm grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.entries(result.batch.summary).map(([k, v]) => (
              <div key={k} className="bg-base-200 rounded-lg px-3 py-2">
                <p className="text-xs text-base-content/50">{k.replace(/_/g, " ")}</p>
                <p className="font-bold">{v}</p>
              </div>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={reset}>Importar otro archivo</button>
        </div>
      )}

      <div className="pt-4">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-2 text-base-content/60">
          <History className="w-4 h-4" /> Historial de importaciones
        </h3>
        <div className="overflow-x-auto bg-base-100 border border-base-300 rounded-xl">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Archivo</th>
                <th>Formato</th>
                <th>Estado</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {history.map((b) => (
                <tr key={b.id}>
                  <td className="text-xs">{b.source_filename}</td>
                  <td className="text-xs">{b.format}</td>
                  <td>
                    <span className={`badge badge-xs ${b.status === "committed" ? "badge-success" : "badge-ghost"}`}>
                      {b.status}
                    </span>
                  </td>
                  <td className="text-xs">{new Date(b.created_at).toLocaleString()}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr><td colSpan={4} className="text-center text-base-content/40 text-sm py-4">Sin importaciones aún.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

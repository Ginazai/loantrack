import { useEffect, useState } from "react";
import { adminApi } from "../../api";
import type { WebhookConfig, WebhookFormData, WebhookEventType } from "../../types";
import { Webhook, Plus, Trash2, ToggleLeft, ToggleRight, Info, X } from "lucide-react";

const ALL_EVENTS: { value: WebhookEventType; label: string; desc: string }[] = [
  { value: "account.created", label: "Account Created", desc: "Fires when any new loan account is opened" },
  { value: "account.updated", label: "Account Updated", desc: "Fires when account details are modified" },
  { value: "payment.added",   label: "Payment Added",   desc: "Fires when a payment is recorded" },
  { value: "status.changed",  label: "Status Changed",  desc: "Fires when account status changes" },
  { value: "account.purged",  label: "Account Purged",  desc: "Fires when a closed account is permanently deleted" },
];

const PAYLOAD_SAMPLE = {
  event: "account.created",
  account_id: "2a257b25-...",
  account_name: "John Doe Loan",
  borrower_name: "John Doe",
  user_id: "05eef7c0-...",
  status: "open",
  borrow_amount: "5000.00",
  rate: "0.0500",
  cycle: 15,
  start_date: "2026-06-15",
  current_balance: "5000.0",
  next_due_date: "2026-06-30",
};

function CreateWebhookModal({ onClose, onCreated }: { onClose: () => void; onCreated: (wh: WebhookConfig) => void }) {
  const [form, setForm] = useState<WebhookFormData>({ target_url: "", events: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleEvent = (ev: WebhookEventType) =>
    setForm((f) => ({
      ...f,
      events: f.events.includes(ev) ? f.events.filter((e) => e !== ev) : [...f.events, ev],
    }));

  const handleCreate = async () => {
    if (!form.target_url || form.events.length === 0) { setError("URL and at least one event are required"); return; }
    setSaving(true); setError(null);
    try {
      const wh = await adminApi.createGlobalWebhook(form);
      onCreated(wh);
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Failed to create webhook");
    } finally { setSaving(false); }
  };

  const lbl = "label-text text-xs font-semibold uppercase tracking-wide";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-base-100 rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-base">New Global Webhook</h3>
          <button className="btn btn-ghost btn-sm btn-square" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        {error && <div className="alert alert-error py-2 text-sm mb-4">{error}</div>}
        <div className="space-y-4">
          <div className="form-control">
            <label className="label py-1"><span className={lbl}>Endpoint URL</span></label>
            <input
              className="input input-bordered input-sm font-mono"
              placeholder="https://eodh8xkd7f2op7r.m.pipedream.net"
              value={form.target_url}
              onChange={(e) => setForm({ ...form, target_url: e.target.value })}
            />
          </div>
          <div>
            <label className="label py-1"><span className={lbl}>Events to Subscribe</span></label>
            <div className="space-y-2">
              {ALL_EVENTS.map(({ value, label, desc }) => (
                <label
                  key={value}
                  className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                    form.events.includes(value) ? "border-primary/40 bg-primary/5" : "border-base-300 hover:bg-base-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary checkbox-sm mt-0.5"
                    checked={form.events.includes(value)}
                    onChange={() => toggleEvent(value)}
                  />
                  <div>
                    <p className="text-sm font-medium font-mono">{value}</p>
                    <p className="text-xs text-base-content/50 mt-0.5">{desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={handleCreate} disabled={saving}>
            {saving ? <span className="loading loading-spinner loading-xs" /> : "Create Webhook"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WebhooksAdminPage() {
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showPayload, setShowPayload] = useState(false);

  useEffect(() => {
    adminApi.listGlobalWebhooks().then(setWebhooks).finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this global webhook?")) return;
    await adminApi.deleteGlobalWebhook(id);
    setWebhooks((prev) => prev.filter((w) => w.id !== id));
  };

  const handleToggle = async (wh: WebhookConfig) => {
    const updated = await adminApi.toggleGlobalWebhook(wh.id, !wh.is_active);
    setWebhooks((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Global Webhooks</h1>
          <p className="text-sm text-base-content/50 mt-0.5 max-w-md">
            Fire for all accounts — invite emails, CRM sync, audit pipelines.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost btn-sm gap-2" onClick={() => setShowPayload(!showPayload)}>
            <Info className="w-4 h-4" /> Payload
          </button>
          <button className="btn btn-primary btn-sm gap-2" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> Add Webhook
          </button>
        </div>
      </div>

      {showPayload && (
        <div className="card bg-neutral text-neutral-content shadow border border-neutral overflow-hidden">
          <div className="card-body p-5">
            <div className="flex items-center gap-2 mb-3">
              <Webhook className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-semibold text-neutral-content/80 uppercase tracking-wider">Sample Payload</h3>
            </div>
            <p className="text-xs text-neutral-content/50 mb-3">Every event POST contains the full account snapshot plus event metadata.</p>
            <pre className="text-xs font-mono text-accent/90 overflow-x-auto bg-black/20 rounded-md p-4 leading-relaxed">
              {JSON.stringify(PAYLOAD_SAMPLE, null, 2)}
            </pre>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {loading ? (
          <div className="p-8 text-center"><span className="loading loading-spinner loading-md text-primary" /></div>
        ) : webhooks.length === 0 ? (
          <div className="card bg-base-100 border border-base-300">
            <div className="card-body p-10 text-center">
              <Webhook className="w-10 h-10 mx-auto text-base-content/20 mb-3" />
              <p className="text-sm text-base-content/40">No global webhooks configured.</p>
            </div>
          </div>
        ) : (
          webhooks.map((wh) => (
            <div key={wh.id} className={`card bg-base-100 shadow-sm border ${wh.is_active ? "border-base-300 card-ledger" : "border-base-300 opacity-60"}`}>
              <div className="card-body p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`badge badge-sm ${wh.is_active ? "badge-success" : "badge-ghost"}`}>
                        {wh.is_active ? "Active" : "Paused"}
                      </span>
                      <span className="badge badge-xs badge-outline font-mono">global</span>
                    </div>
                    <p className="font-mono text-sm mt-2 break-all text-base-content/80">{wh.target_url}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {wh.events.map((ev) => (
                        <span key={ev} className="badge badge-xs badge-accent badge-outline font-mono">{ev}</span>
                      ))}
                    </div>
                    <p className="text-xs text-base-content/30 font-mono mt-2">
                      Created {new Date(wh.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button className="btn btn-ghost btn-xs" onClick={() => handleToggle(wh)} title={wh.is_active ? "Pause" : "Resume"}>
                      {wh.is_active ? <ToggleRight className="w-4 h-4 text-success" /> : <ToggleLeft className="w-4 h-4" />}
                    </button>
                    <button className="btn btn-ghost btn-xs text-error" onClick={() => handleDelete(wh.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {showCreate && (
        <CreateWebhookModal
          onClose={() => setShowCreate(false)}
          onCreated={(wh) => setWebhooks((prev) => [wh, ...prev])}
        />
      )}
    </div>
  );
}

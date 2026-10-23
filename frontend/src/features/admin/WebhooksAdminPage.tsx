import { Add, Webhook } from "@carbon/icons-react";
import { Button, CodeSnippet, Checkbox, InlineLoading, Layer, SkeletonText, Tag, TextInput, Toggle } from "@carbon/react";
import { TrashCan } from "@carbon/icons-react";
import { useEffect, useState } from "react";
import { adminApi } from "../../api";
import type { WebhookConfig, WebhookFormData, WebhookEventType } from "../../types";
import { getApiErrorMessage } from "../../utils/apiError";
import { ConfirmDialog, Drawer, EmptyState, Notice, PageHeader } from "../../components/common";

const ALL_EVENTS: { value: WebhookEventType; label: string; desc: string }[] = [
  { value: "account.created", label: "Account Created", desc: "Fires when any new loan account is opened" },
  { value: "account.updated", label: "Account Updated", desc: "Fires when account details are modified" },
  { value: "payment.added",   label: "Payment Added",   desc: "Fires when a payment is recorded" },
  { value: "status.changed",  label: "Status Changed",  desc: "Fires when account status changes" },
  { value: "account.purged",  label: "Account Purged",  desc: "Fires when a closed account is permanently deleted" },
  { value: "cycle.closed",    label: "Cycle Closed",    desc: "Fires when a billing cycle (15th/30th) closes, even with no payment that day" },
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
      setError(getApiErrorMessage(e, "Failed to create webhook"));
    } finally { setSaving(false); }
  };

  return (
    <Drawer title="New Global Webhook" onClose={onClose}>
      <form
        className="lt-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          handleCreate();
        }}
      >
        {error && <Notice kind="error">{error}</Notice>}
        <TextInput
          id="global-webhook-url"
          labelText="Endpoint URL"
          placeholder="https://eodh8xkd7f2op7r.m.pipedream.net"
          value={form.target_url}
          onChange={(e) => setForm({ ...form, target_url: e.target.value })}
        />
        <fieldset className="lt-fieldset">
          <legend className="cds--label">Events to Subscribe</legend>
          <div className="lt-stack lt-stack--tight">
            {ALL_EVENTS.map(({ value, label, desc }) => {
              const checked = form.events.includes(value);
              return (
                <div key={value} className={`lt-option-card${checked ? " lt-option-card--checked" : ""}`}>
                  <Checkbox
                    id={`global-ev-${value}`}
                    labelText={<span className="lt-mono">{value}</span>}
                    checked={checked}
                    onChange={() => toggleEvent(value)}
                    aria-label={label}
                  />
                  <p className="lt-option-card__desc">{desc}</p>
                </div>
              );
            })}
          </div>
        </fieldset>
        <div className="lt-form__actions lt-form__actions--bleed">
          <Button type="button" kind="secondary" size="xl" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="xl" disabled={saving}>
            {saving ? <InlineLoading description="Creating…" /> : "Create webhook"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

export default function WebhooksAdminPage() {
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showPayload, setShowPayload] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    adminApi.listGlobalWebhooks().then(setWebhooks).finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string) => {
    await adminApi.deleteGlobalWebhook(id);
    setWebhooks((prev) => prev.filter((w) => w.id !== id));
    setDeleteId(null);
  };

  const handleToggle = async (wh: WebhookConfig) => {
    const updated = await adminApi.toggleGlobalWebhook(wh.id, !wh.is_active);
    setWebhooks((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
  };

  return (
    <div className="lt-page lt-page--narrow lt-stack lt-stack--loose">
      <PageHeader
        title="Global Webhooks"
        subtitle="Fire for all accounts — invite emails, CRM sync, audit pipelines."
        action={
          <>
            <Button
              kind="ghost"
              size="md"
              aria-expanded={showPayload}
              onClick={() => setShowPayload(!showPayload)}
            >
              {showPayload ? "Hide payload" : "Payload"}
            </Button>
            <Button size="md" renderIcon={Add} onClick={() => setShowCreate(true)}>
              Add webhook
            </Button>
          </>
        }
      />

      {showPayload && (
        <section className="lt-panel lt-panel__body" aria-labelledby="payload-heading">
          <h2 className="lt-section-title" id="payload-heading">Sample Payload</h2>
          <p className="lt-muted" style={{ marginBlockEnd: "1rem" }}>
            Every event POST contains the full account snapshot plus event metadata.
          </p>
          <Layer>
            <CodeSnippet type="multi" feedback="Copied" wrapText>
              {JSON.stringify(PAYLOAD_SAMPLE, null, 2)}
            </CodeSnippet>
          </Layer>
        </section>
      )}

      {loading ? (
        <div aria-busy="true" aria-label="Loading webhooks">
          <SkeletonText paragraph lineCount={3} />
        </div>
      ) : webhooks.length === 0 ? (
        <div className="lt-panel">
          <EmptyState
            Icon={Webhook}
            title="No global webhooks configured."
            description="Add an endpoint to receive events from every account."
            action={<Button renderIcon={Add} onClick={() => setShowCreate(true)}>Add webhook</Button>}
          />
        </div>
      ) : (
        <div className="lt-stack lt-stack--tight">
          {webhooks.map((wh) => (
            <article key={wh.id} className={`lt-item${wh.is_active ? "" : " lt-item--muted"}`}>
              <div className="lt-item__top">
                <div className="lt-item__main">
                  <div className="lt-row">
                    <Tag size="sm" type={wh.is_active ? "green" : "gray"}>
                      {wh.is_active ? "Active" : "Paused"}
                    </Tag>
                    <Tag size="sm" type="outline">global</Tag>
                  </div>
                  <p className="lt-item__url lt-mono">{wh.target_url}</p>
                  <div className="lt-row" style={{ gap: "0.25rem" }}>
                    {wh.events.map((ev) => (
                      <Tag key={ev} size="sm" type="outline">
                        <span className="lt-mono">{ev}</span>
                      </Tag>
                    ))}
                  </div>
                  <p className="lt-field-note" style={{ marginBlockStart: "0.75rem" }}>
                    Created {new Date(wh.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="lt-table-actions">
                  <Toggle
                    id={`wh-toggle-${wh.id}`}
                    size="sm"
                    hideLabel
                    labelText=""
                    aria-label={wh.is_active ? "Webhook active — switch off to pause" : "Webhook paused — switch on to resume"}
                    toggled={wh.is_active}
                    onToggle={() => handleToggle(wh)}
                  />
                  <Button
                    kind="danger--ghost"
                    size="sm"
                    hasIconOnly
                    renderIcon={TrashCan}
                    iconDescription="Delete webhook"
                    tooltipPosition="left"
                    onClick={() => setDeleteId(wh.id)}
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateWebhookModal
          onClose={() => setShowCreate(false)}
          onCreated={(wh) => setWebhooks((prev) => [wh, ...prev])}
        />
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete Global Webhook"
          message="This will stop delivering events to this endpoint. This can't be undone."
          confirmLabel="Delete webhook"
          dangerous
          onConfirm={() => handleDelete(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}

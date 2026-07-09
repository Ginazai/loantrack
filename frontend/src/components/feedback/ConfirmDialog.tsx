import { useState } from "react";
interface Props { title: string; message: string; confirmLabel?: string; confirmWord?: string; dangerous?: boolean; onConfirm: () => void; onCancel: () => void; }
export function ConfirmDialog({ title, message, confirmLabel = "Confirm", confirmWord, dangerous = false, onConfirm, onCancel }: Props) {
  const [typed, setTyped] = useState("");
  const canConfirm = !confirmWord || typed === confirmWord;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-base-100 rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
        <h3 className="font-bold text-lg mb-2">{title}</h3>
        <p className="text-base-content/70 text-sm mb-4">{message}</p>
        {confirmWord && (
          <div className="mb-4">
            <label className="label"><span className="label-text text-sm">Type <strong>{confirmWord}</strong> to confirm</span></label>
            <input className="input input-bordered input-sm w-full" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={confirmWord} />
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
          <button className={`btn btn-sm ${dangerous ? "btn-error" : "btn-primary"}`} onClick={onConfirm} disabled={!canConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

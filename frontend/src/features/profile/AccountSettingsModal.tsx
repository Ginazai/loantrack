import { useState } from "react";
import { X, Save, KeyRound, User } from "lucide-react";
import { authApi } from "../../api";
import { useAuthStore } from "../../stores/authStore";

interface Props { onClose: () => void; }

export function AccountSettingsModal({ onClose }: Props) {
  const { user, setUser } = useAuthStore();
  const [name, setName] = useState(user?.full_name ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSave = async () => {
    setError(null);
    if (password && password !== confirm) { setError("Passwords do not match"); return; }
    if (password && password.length < 8) { setError("Password must be at least 8 characters"); return; }
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      if (name !== user?.full_name) payload.full_name = name;
      if (password) payload.password = password;
      if (Object.keys(payload).length === 0) { onClose(); return; }
      const updated = await authApi.updateMe(payload);
      setUser(updated);
      setSuccess(true);
      setPassword(""); setConfirm("");
      setTimeout(onClose, 900);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "Failed to save");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-base-100 rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-bold text-base">Account Settings</h2>
          <button className="btn btn-ghost btn-sm btn-square" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        {error && <div className="alert alert-error py-2 text-sm mb-4">{error}</div>}
        {success && <div className="alert alert-success py-2 text-sm mb-4">Saved!</div>}
        <div className="space-y-4">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-base-content/40 mb-3">
              <User className="w-3.5 h-3.5" /> Profile
            </p>
            <div className="form-control">
              <label className="label py-1"><span className="label-text text-xs font-semibold uppercase tracking-wide">Display Name</span></label>
              <input className="input input-bordered input-sm" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="form-control mt-3">
              <label className="label py-1"><span className="label-text text-xs font-semibold uppercase tracking-wide">Email</span></label>
              <input className="input input-bordered input-sm bg-base-200 cursor-not-allowed" value={user?.email ?? ""} disabled />
              <span className="text-xs text-base-content/30 mt-1">Contact admin to change email</span>
            </div>
          </div>
          <hr className="border-dashed border-base-300" />
          <div>
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-base-content/40 mb-3">
              <KeyRound className="w-3.5 h-3.5" /> Change Password
            </p>
            <div className="space-y-3">
              <div className="form-control">
                <label className="label py-1"><span className="label-text text-xs font-semibold uppercase tracking-wide">New Password</span></label>
                <input type="password" className="input input-bordered input-sm" placeholder="Leave blank to keep current" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="form-control">
                <label className="label py-1"><span className="label-text text-xs font-semibold uppercase tracking-wide">Confirm Password</span></label>
                <input type="password" className="input input-bordered input-sm" placeholder="Repeat new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm gap-1.5" onClick={handleSave} disabled={saving}>
            {saving ? <span className="loading loading-spinner loading-xs" /> : <Save className="w-3.5 h-3.5" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

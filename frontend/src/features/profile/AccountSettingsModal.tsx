import { Button, FormGroup, InlineLoading, PasswordInput, TextInput } from "@carbon/react";
import { useState } from "react";
import { authApi } from "../../api";
import { useAuthStore } from "../../stores/authStore";
import type { SelfUpdateData } from "../../types";
import { getApiErrorMessage } from "../../utils/apiError";
import { Drawer, Notice } from "../../components/common";

interface Props { onClose: () => void; }

export function AccountSettingsModal({ onClose }: Props) {
  const { user, setUser } = useAuthStore();
  const [name, setName] = useState(user?.full_name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSave = async () => {
    setError(null);
    if (password && password !== confirm) { setError("Passwords do not match"); return; }
    if (password && password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (password && !currentPassword) { setError("Enter your current password to set a new one"); return; }
    setSaving(true);
    try {
      const payload: SelfUpdateData = {};
      if (name !== user?.full_name) payload.full_name = name;
      if (password) {
        payload.current_password = currentPassword;
        payload.new_password = password;
      }
      if (Object.keys(payload).length === 0) { onClose(); return; }
      const updated = await authApi.updateMe(payload);
      setUser(updated);
      setSuccess(true);
      setCurrentPassword(""); setPassword(""); setConfirm("");
      setTimeout(onClose, 900);
    } catch (e: any) {
      setError(getApiErrorMessage(e, "Failed to save"));
    } finally { setSaving(false); }
  };

  return (
    <Drawer title="Account Settings" onClose={onClose}>
      <form
        className="lt-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        {error && <Notice kind="error">{error}</Notice>}
        {success && <Notice kind="success">Changes saved.</Notice>}

        <FormGroup legendText="Profile">
          <div className="lt-form">
            <TextInput
              id="settings-name"
              labelText="Display Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <TextInput
              id="settings-email"
              labelText="Email"
              value={user?.email ?? ""}
              disabled
              helperText="Contact admin to change email"
            />
          </div>
        </FormGroup>

        <FormGroup legendText="Change Password">
          <div className="lt-form">
            <PasswordInput
              id="settings-current-password"
              labelText="Current Password"
              placeholder="Only needed to set a new password"
              helperText="Setting a new password signs you out on your other devices."
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <PasswordInput
              id="settings-password"
              labelText="New Password"
              placeholder="Leave blank to keep current"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <PasswordInput
              id="settings-confirm"
              labelText="Confirm Password"
              placeholder="Repeat new password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </FormGroup>

        <div className="lt-form__actions lt-form__actions--bleed">
          <Button type="button" kind="secondary" size="lg" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="lg" disabled={saving}>
            {saving ? <InlineLoading description="Saving…" /> : "Save changes"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

import { Button, FormGroup, InlineLoading, PasswordInput, TextInput } from "@carbon/react";
import { useState } from "react";
import { authApi } from "../../api";
import { useAuthStore } from "../../stores/authStore";
import { getApiErrorMessage } from "../../utils/apiError";
import { Drawer, Notice } from "../../components/common";

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
          handleSave();
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
          <Button type="button" kind="secondary" size="xl" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="xl" disabled={saving}>
            {saving ? <InlineLoading description="Saving…" /> : "Save Changes"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

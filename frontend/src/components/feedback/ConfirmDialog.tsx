import { Modal, TextInput } from "@carbon/react";
import { useState } from "react";

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  /** If set, the user must type this exactly before the confirm button enables. */
  confirmWord?: string;
  dangerous?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Brief binary decisions (delete, close) — Carbon's destructive-modal pattern. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  confirmWord,
  dangerous = false,
  onConfirm,
  onCancel,
}: Props) {
  const [typed, setTyped] = useState("");
  const canConfirm = !confirmWord || typed === confirmWord;

  return (
    <Modal
      open
      size="sm"
      danger={dangerous}
      modalHeading={title}
      primaryButtonText={confirmLabel}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={!canConfirm}
      onRequestSubmit={() => canConfirm && onConfirm()}
      onRequestClose={onCancel}
      onSecondarySubmit={onCancel}
      preventCloseOnClickOutside
    >
      <p>{message}</p>
      {confirmWord && (
        <div className="lt-mt-lg">
          <TextInput
            id="confirm-word"
            labelText={
              <>
                Type <strong>{confirmWord}</strong> to confirm
              </>
            }
            placeholder={confirmWord}
            value={typed}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
      )}
    </Modal>
  );
}

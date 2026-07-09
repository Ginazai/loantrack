import { useState, useCallback } from "react";
/** Headless confirm state — pair with ConfirmDialog. */
export function useConfirm() {
  const [target, setTarget] = useState<string | null>(null);
  const ask = useCallback((id: string) => setTarget(id), []);
  const cancel = useCallback(() => setTarget(null), []);
  return { target, ask, cancel };
}

import { useCallback, useState } from "react";
import { getApiErrorMessage } from "../utils/apiError";

/**
 * Tracks a file download so a failure is shown instead of vanishing: `run` starts it,
 * `pending` disables the trigger meanwhile, `error` holds a displayable message until
 * `clear` or the next attempt.
 */
export function useDownload() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (job: () => Promise<void>, failureMessage: string) => {
    setPending(true);
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(getApiErrorMessage(e, failureMessage));
    } finally {
      setPending(false);
    }
  }, []);

  const clear = useCallback(() => setError(null), []);

  return { run, pending, error, clear };
}

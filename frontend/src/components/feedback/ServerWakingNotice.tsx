import { useConnectionStore } from "../../stores/connectionStore";
import { Notice } from "./Notice";

/** Shown while the API client is waiting for a sleeping backend to come up. */
export function ServerWakingNotice() {
  const waking = useConnectionStore((s) => s.waking);
  if (!waking) return null;
  return (
    <div className="lt-waking">
      <Notice kind="info" title="Connecting to the server">
        It was idle and is starting up, which can take a minute or two. Your request will
        continue automatically.
      </Notice>
    </div>
  );
}

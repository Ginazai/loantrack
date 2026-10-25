import { create } from "zustand";

/**
 * True while the API client is retrying requests because the backend looks
 * asleep (Render spins idle services down). Drives <ServerWakingNotice />.
 */
interface ConnectionState {
  waking: boolean;
  setWaking: (waking: boolean) => void;
}

export const useConnectionStore = create<ConnectionState>()((set) => ({
  waking: false,
  setWaking: (waking) => set({ waking }),
}));

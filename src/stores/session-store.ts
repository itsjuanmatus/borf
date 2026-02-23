import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface SessionState {
  volume: number;
  sidebarSize: number;
  setVolume: (volume: number) => void;
  setSidebarSize: (size: number) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      volume: 0.8,
      sidebarSize: 22,
      setVolume: (volume) => set({ volume }),
      setSidebarSize: (sidebarSize) => set({ sidebarSize }),
    }),
    {
      name: "borf-session",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ volume: state.volume, sidebarSize: state.sidebarSize }),
    },
  ),
);

import { create } from 'zustand'

// Whether the cheat/debug console is open — a store rather than component
// state so the Sandbox panel can open it too, not just the backtick key.
interface DebugConsoleState {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

export const useDebugConsoleStore = create<DebugConsoleState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}))

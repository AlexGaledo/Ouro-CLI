import { create } from "zustand";

// Chrome layout state. Persisted to localStorage because a collapsed rail or a
// resized terminal that resets on every reload is worse than not having the
// control at all.

const KEY = "ouro.ui.v1";

const DEFAULTS = {
  view: "board", // "board" | "agents"
  railCollapsed: false,
  ticketsOpen: true,
  agentsOpen: true,
  terminalOpen: true,
  terminalHeight: 200,
  autoscroll: true,
};

export const TERMINAL_MIN = 90;
export const TERMINAL_MAX = 560;

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export const useUI = create((set, get) => ({
  ...load(),

  set(patch) {
    set(patch);
    const { view, railCollapsed, ticketsOpen, agentsOpen, terminalOpen, terminalHeight, autoscroll } = get();
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ view, railCollapsed, ticketsOpen, agentsOpen, terminalOpen, terminalHeight, autoscroll })
      );
    } catch {
      // Private mode / quota — layout just won't persist. Not worth surfacing.
    }
  },

  toggle(key) {
    get().set({ [key]: !get()[key] });
  },

  setTerminalHeight(px) {
    get().set({ terminalHeight: Math.min(TERMINAL_MAX, Math.max(TERMINAL_MIN, px)) });
  },
}));

import { create } from "zustand";

// Agents live in `.ouro/agents/*.md` on disk. The server broadcasts an `agent`
// event whenever one changes — from this UI or from someone editing the file
// in their editor — so this store never caches optimistically. It refetches
// and repaints, which is what makes "edit the .md in vim, watch the dashboard
// update" work.

export const useAgents = create((set, get) => ({
  agents: [],
  toolUniverse: [],
  defaultAgentId: null,
  loading: true,
  error: null,
  selectedId: null,

  async hydrate() {
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) throw new Error(`GET /api/agents → ${res.status}`);
      const { agents, toolUniverse, defaultAgentId } = await res.json();

      set((state) => ({
        agents,
        toolUniverse,
        defaultAgentId,
        loading: false,
        error: null,
        // Keep the current selection if it still exists; else fall to the first.
        selectedId: agents.some((a) => a.id === state.selectedId)
          ? state.selectedId
          : (agents[0]?.id ?? null),
      }));
    } catch (err) {
      set({ loading: false, error: String(err.message || err) });
    }
  },

  select(id) {
    set({ selectedId: id });
  },

  async create(name) {
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    const agent = await res.json();
    await get().hydrate();
    set({ selectedId: agent.id });
    return agent;
  },

  /** `patch` is either structured fields or `{ raw }` to replace the whole file. */
  async save(id, patch) {
    const res = await fetch(`/api/agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    const agent = await res.json();
    await get().hydrate();
    return agent;
  },

  async remove(id) {
    const res = await fetch(`/api/agents/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    set({ selectedId: null });
    await get().hydrate();
  },

  async fetchRaw(id) {
    const res = await fetch(`/api/agents/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).raw ?? "";
  },
}));

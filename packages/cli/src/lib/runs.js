// Registry of in-flight agent runs, keyed by ticket id.
//
// Cancellation is real, not cosmetic: each run gets an AbortController whose
// signal is handed to `spawn()`, so aborting sends SIGTERM to the CLI child
// process itself rather than just flipping a flag and letting the model keep
// burning tokens in the background.
//
// One run per ticket at a time — starting a second while one is live would
// leave the first unreachable, so `begin()` refuses instead.

const runs = new Map(); // ticketId -> { controller, startedAt, phase }

export function isRunning(ticketId) {
  return runs.has(ticketId);
}

export function begin(ticketId, phase = "run") {
  if (runs.has(ticketId)) {
    throw new Error(`Ticket ${ticketId} already has a run in flight`);
  }
  const controller = new AbortController();
  runs.set(ticketId, { controller, startedAt: Date.now(), phase });
  return controller.signal;
}

export function end(ticketId) {
  runs.delete(ticketId);
}

/** True if there was a live run to kill; false if it had already finished. */
export function cancel(ticketId) {
  const run = runs.get(ticketId);
  if (!run) return false;
  run.controller.abort();
  runs.delete(ticketId);
  return true;
}

/** Was this ticket's run killed by us, rather than exiting on its own? */
export function wasAborted(signal) {
  return Boolean(signal?.aborted);
}

export function activeRuns() {
  return [...runs.entries()].map(([ticketId, run]) => ({
    ticketId,
    phase: run.phase,
    startedAt: run.startedAt,
  }));
}

/** Kill everything — used when the dashboard process is shutting down. */
export function cancelAll() {
  for (const id of [...runs.keys()]) cancel(id);
}

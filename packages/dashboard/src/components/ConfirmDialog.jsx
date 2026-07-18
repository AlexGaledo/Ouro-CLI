import { useEffect, useRef } from "react";

// A blocking yes/no gate for switches that carry a consequence — chiefly the
// run-mode toggles, where flipping to "agent" hands over full autonomy and the
// user should read what that means before it takes effect. Presentational only:
// it owns no state and touches no store, so a caller can reuse it for any
// confirm-then-commit interaction by wiring onConfirm/onCancel to its own logic.
//
// Markup mirrors NewTicketForm so both modals share the same backdrop, panel,
// and action-row styling without a second set of CSS to keep in sync.
export default function ConfirmDialog({ title, message, confirmLabel, tone, onConfirm, onCancel }) {
  // The confirm button gets focus on mount so the keyboard path is a single
  // Enter, and Tab lands somewhere sensible rather than back on the page behind.
  const confirmRef = useRef(null);

  useEffect(() => {
    confirmRef.current?.focus();
    // Escape has to close a modal — it's the one dismissal every user tries
    // before reaching for the mouse. Escape cancels (never confirms): a
    // destructive default should never fire from a reflex keypress.
    // Pass the event through: a caller may wrap onCancel to stopPropagation
    // (a card-nested dialog does, so Escape doesn't bubble to card selection).
    // Callers that ignore the arg are unaffected.
    const onKey = (e) => {
      if (e.key === "Escape") onCancel(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <h3 id="confirm-dialog-title">{title}</h3>
        <p>{message}</p>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          {/* danger tone paints the confirm red for the switch that grants
              autonomy; every other confirm reads as an ordinary primary action. */}
          <button
            type="button"
            ref={confirmRef}
            className={tone === "danger" ? "btn danger" : "btn primary"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

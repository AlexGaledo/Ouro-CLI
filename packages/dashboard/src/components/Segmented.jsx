import { useLayoutEffect, useRef, useState } from "react";

/**
 * Segmented control with a pill that slides between options.
 *
 * The pill is one absolutely-positioned element whose transform is measured
 * from the real DOM rather than computed from an assumed equal-width layout —
 * the options here are text of different lengths ("Human-in-loop" vs "Agent"),
 * so equal-width maths would drift. Measuring also survives a font swap.
 *
 * Implemented as a radiogroup so arrow keys move the selection, which is what
 * a keyboard user expects from something that looks like this.
 */
export default function Segmented({ value, options, onChange, ariaLabel }) {
  const wrapRef = useRef(null);
  const [pill, setPill] = useState(null);

  const index = options.findIndex((o) => o.value === value);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || index < 0) {
      setPill(null);
      return;
    }

    const measure = () => {
      const active = wrap.querySelectorAll("[data-opt]")[index];
      if (!active) return;
      setPill({ left: active.offsetLeft, width: active.offsetWidth });
    };

    measure();
    // Re-measure on container resize: the topbar reflows at breakpoints, and a
    // pill pinned to stale coordinates is worse than no pill.
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [index, options]);

  function onKeyDown(e) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const next = (index + delta + options.length) % options.length;
    onChange(options[next].value);
  }

  return (
    <div
      ref={wrapRef}
      className="segmented"
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      {pill && (
        <span
          className="segmented-pill"
          style={{ transform: `translateX(${pill.left}px)`, width: pill.width }}
        />
      )}
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            data-opt
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={`segmented-opt ${on ? "on" : ""}`}
            onClick={() => onChange(opt.value)}
            title={opt.title}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

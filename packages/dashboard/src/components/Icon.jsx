// Inline SVG icon set (Lucide geometry, redrawn at 24x24 / stroke 2).
//
// Inline rather than a package: the dashboard is served from a local Node
// process with no CDN reachable offline, and shipping a whole icon library to
// use nine glyphs is dead weight in the bundle. Emoji are not an option —
// they render differently per platform and can't inherit currentColor.

const PATHS = {
  inbox: "M22 12h-6l-2 3h-4l-2-3H2 M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
  agents: "M12 8V4H8 M4 8h16v12H4z M2 14h2 M20 14h2 M15 13v2 M9 13v2",
  play: "m6 3 14 9-14 9V3z",
  stop: "M5 5h14v14H5z",
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18 M6 6l12 12",
  chevronRight: "m9 18 6-6-6-6",
  chevronDown: "m6 9 6 6 6-6",
  chevronsLeft: "m11 17-5-5 5-5 M18 17l-5-5 5-5",
  chevronsRight: "m6 17 5-5-5-5 M13 17l5-5-5-5",
  plus: "M5 12h14 M12 5v14",
  terminal: "m4 17 6-6-6-6 M12 19h8",
  trash: "M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  rotate: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5",
  save: "M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M17 21v-8H7v8 M7 3v5h8",
  file: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z M14 2v4a2 2 0 0 0 2 2h4",
  alert: "M12 9v4 M12 17h.01 M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z",
  search: "m21 21-4.34-4.34 M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0z",
  gitBranch: "M6 3v12 M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M15 9a9 9 0 0 1-9 9",
  settings: "M20 7h-9 M14 17H5 M17 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M7 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  send: "m22 2-7 20-4-9-9-4Z M22 2 11 13",
};

export default function Icon({ name, size = 16, className = "", ...rest }) {
  const d = PATHS[name];
  if (!d) return null;

  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {d.split(" M").map((segment, i) => (
        <path key={i} d={i === 0 ? segment : `M${segment}`} />
      ))}
    </svg>
  );
}

/**
 * The ouroboros mark — a snake eating its own tail, which is the whole product
 * in one glyph: a ticket goes in, an agent runs, a PR comes out, and the loop
 * closes back onto the repo it started from.
 *
 * Hand-drawn as inline SVG rather than shipping assets/Ouro_logo.jpeg into the
 * chrome, for three reasons the JPEG can't solve:
 *   - it's opaque, so it lands as a black square seam on any surface that
 *     isn't exactly its own background;
 *   - it's raster, so a 20px favicon renders as artefacts;
 *   - it can't be tinted, and this mark has to sit at --brand in the rail but
 *     go --bad the moment the socket drops.
 *
 * Everything is stroked with `currentColor`, so colour is inherited from CSS
 * and the mark participates in the violet ladder like any other element. The
 * JPEG still gets its moment in the README banner, where size is free and the
 * background is the artwork's own.
 *
 * GEOMETRY. Centre (32,32), body radius 22. The body runs from the head at 60°
 * the long way round (large-arc=1) to 100°, then narrows through two shorter
 * arcs — sw 4 → 2.6 → 1.5 — so the tail thins as it approaches the mouth and
 * the jaws close on a taper rather than on a blunt stump. A stroke can't vary
 * its own width, so the taper is stepped and the round caps hide the joins.
 *
 * The tail tip lands at 85° — (33.9, 10.1) — and the jaws are placed at x≈33.7
 * spanning y 7.7 to 12.6, so the tail passes *between* them. That's the entire
 * point of the symbol, so those numbers have to agree; move one, move both.
 *
 * Angles are standard maths (0° = east, anticlockwise). SVG's y-down flips the
 * sign, which is why sweep-flag=1 reads as clockwise on screen.
 */

// Circuit traces etched inside the ring — the logo's "this is a machine, not a
// mystic symbol" tell. Radial ticks from r19 to r15 with a via at the end,
// drawn at 12 o'clock and rotated into place. Angles are hand-picked to clear
// the head (roughly 30–70°) and to avoid clumping; a random scatter reads as
// noise at this size. Lengths vary so the set doesn't read as a clock face.
const TRACES = [
  [100, 4], [135, 2.5], [170, 4], [205, 3],
  [240, 4.5], [275, 2.5], [310, 4], [340, 3],
];

export default function Logo({ size = 20, title, className = "" }) {
  return (
    <svg
      className={`logo ${className}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative next to the "ouro" wordmark, so it's hidden from the a11y
      // tree unless a caller gives it a title of its own.
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : "true"}
      aria-label={title}
    >
      {title && <title>{title}</title>}

      {/* Body: head at 60°, the long way round to 100°. */}
      <path d="M43 12.95A22 22 0 1 1 28.18 10.33" strokeWidth="4" />
      {/* Tail, narrowing into the mouth. */}
      <path d="M28.18 10.33A22 22 0 0 1 32 10" strokeWidth="2.6" />
      <path d="M32 10A22 22 0 0 1 33.92 10.08" strokeWidth="1.5" />
      {/* The lit core of the neon tube — a thinner, brighter line riding the
          body's own path. That doubling is what makes it read as a tube rather
          than a stroke, and it's the one flourish taken straight from the art. */}
      <path d="M43 12.95A22 22 0 1 1 28.18 10.33" strokeWidth="1.3" opacity="0.7" />

      {/* Traces sit inside the hole (r19 → r15), well clear of the r20 edge. */}
      <g opacity="0.4" strokeWidth="0.8">
        {TRACES.map(([deg, len]) => (
          <g key={deg} transform={`rotate(${deg} 32 32)`}>
            <path d={`M32 13v${len}`} />
            <circle cx="32" cy={13 + len} r="0.85" fill="currentColor" stroke="none" />
          </g>
        ))}
        {/* Two concentric fragments, to break the radial ticks out of reading
            as a clock face. In the source art the traces run *along* the ring
            as much as across it. */}
        <path d="M15.26 34.95A17 17 0 0 0 23.5 46.72" />
        <path d="M43.4 43.4A17 17 0 0 0 48.4 36.1" />
      </g>

      {/* Head: a filled wedge rising off the body, tapering to open jaws that
          close around the tail. Filled rather than stroked because a snake's
          head tapers and a stroke can't. */}
      <path
        d="M42.8 14.8
           C46.6 14.6 49.6 12.3 49.4 8.8
           C49.2 6.0 46.8 4.5 43.6 5.0
           L33.6 7.7
           L40.2 10.3
           L33.8 12.6
           C36.6 14.6 39.8 15.0 42.8 14.8 Z"
        fill="currentColor"
        stroke="none"
      />
      {/* Eye — punched out of the head in the page's own background, so it
          reads at 19px where a stroked ring would silt up. */}
      <circle cx="45.8" cy="9.2" r="1.15" fill="var(--bg, #0b0a12)" stroke="none" />
    </svg>
  );
}

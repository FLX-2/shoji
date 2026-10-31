/** The Shoji mark as used inside the app: two sliding panels, without the red seal,
 *  so that red only ever means running or spending. */
export function Mark({ large = false, className }: { large?: boolean; className?: string }) {
  const panel = large ? "#4d4b48" : "#6f6c68";
  const overlap = large ? "#33312f" : "#57544f";
  return (
    <svg className={className} viewBox="12 5 48 42" aria-hidden="true">
      <rect x="12" y="5" width="30" height="42" rx="1.5" fill={panel} />
      <rect x="30" y="5" width="30" height="42" rx="1.5" fill={panel} />
      <rect x="30" y="5" width="12" height="42" fill={overlap} />
    </svg>
  );
}

/** Shown beside the step Shoji is working on: the mark's two panels slide shut over each other and
 *  open again, and the safelight shows where they overlap. It rests in the mark's own pose when
 *  interface motion is off. */
export function Working() {
  // Each panel is 10 by 14, overlapping by 4, as in the mark. The panels move toward each other by
  // the same amount, so their overlap stays centred and only grows, and is drawn as its own rect.
  return (
    <svg className="working" viewBox="0 0 16 14" aria-hidden="true">
      <rect className="pa" width="10" height="14" rx="1" />
      <rect className="pb" x="6" width="10" height="14" rx="1" />
      <rect className="po" x="6" width="4" height="14" />
    </svg>
  );
}

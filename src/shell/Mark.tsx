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

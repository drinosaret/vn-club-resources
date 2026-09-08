/** A rule across the river with the day on it. */
export function DayDivider({ label }: { label: string }) {
  return (
    <h2 className="nw-day-rule">
      <span>{label}</span>
    </h2>
  );
}

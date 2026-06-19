export function StatusBadge({ status }: { status: string }) {
  const cls = status.replace(/\s+/g, '-');
  const label = status
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  return (
    <span
      className={`status-text ${cls}`}
      title={status}
    >
      {label}
    </span>
  );
}

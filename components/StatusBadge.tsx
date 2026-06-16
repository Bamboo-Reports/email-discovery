export function StatusBadge({ status }: { status: string }) {
  const cls = status.replace(/\s+/g, '-');
  return (
    <span
      className={`badge ${cls}`}
      title={status}
    >
      <span className="badge-label">{status}</span>
    </span>
  );
}

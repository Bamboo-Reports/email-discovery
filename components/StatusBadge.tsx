import {
  RiCheckboxCircleFill,
  RiCloseCircleFill,
  RiErrorWarningFill,
  RiIndeterminateCircleFill,
  RiTimeFill,
} from '@remixicon/react';

const ICONS = {
  valid: RiCheckboxCircleFill,
  'accept-all': RiErrorWarningFill,
  invalid: RiCloseCircleFill,
  'not-found': RiIndeterminateCircleFill,
  pending: RiTimeFill,
} as const;

export function StatusBadge({ status }: { status: string }) {
  const cls = status.replace(/\s+/g, '-');
  const label = status
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  const Icon = ICONS[cls as keyof typeof ICONS];
  return (
    <span
      className={`status-text ${cls}`}
      title={status}
    >
      {Icon && <Icon size={14} aria-hidden="true" />}
      {label}
    </span>
  );
}

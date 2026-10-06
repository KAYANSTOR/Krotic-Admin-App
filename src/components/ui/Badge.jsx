import { cn } from '../../lib/cn';

const TONES = {
  brand: 'badge--brand',
  success: 'badge--success',
  warning: 'badge--warning',
  danger: 'badge--danger',
  gold: 'badge--gold',
  neutral: 'badge--neutral',
  info: 'badge--info',
};

export default function Badge({ tone = 'neutral', dot = false, className, children }) {
  return (
    <span className={cn('badge', TONES[tone] || TONES.neutral, className)}>
      {dot && <span className="badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

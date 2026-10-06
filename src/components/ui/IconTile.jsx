import { cn } from '../../lib/cn';

const TONES = {
  brand: 'icon-tile--brand',
  success: 'icon-tile--success',
  warning: 'icon-tile--warning',
  danger: 'icon-tile--danger',
  gold: 'icon-tile--gold',
  neutral: 'icon-tile--neutral',
};

export default function IconTile({ icon: Icon, tone = 'brand', size = 'md', className }) {
  return (
    <span className={cn('icon-tile', TONES[tone], size === 'sm' && 'icon-tile--sm', size === 'lg' && 'icon-tile--lg', className)}>
      {Icon && <Icon className={size === 'lg' ? 'w-5 h-5' : 'w-4 h-4'} aria-hidden="true" />}
    </span>
  );
}

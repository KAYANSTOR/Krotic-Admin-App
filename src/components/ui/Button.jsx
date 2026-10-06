import { cn } from '../../lib/cn';

const VARIANTS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  success: 'btn-success',
  soft: 'btn-soft',
};

const SIZES = { xs: 'btn-xs', sm: 'btn-sm', md: '', lg: 'btn-lg', icon: 'btn-icon' };

export default function Button({
  as: Component = 'button',
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  block = false,
  icon: Icon = null,
  iconEnd: IconEnd = null,
  className,
  children,
  type,
  ...rest
}) {
  const isButton = Component === 'button';
  const isDisabled = disabled || loading;

  if (isButton) {
    return (
      <button
        type={type || 'button'}
        disabled={isDisabled}
        className={cn('btn', VARIANTS[variant], SIZES[size], block && 'btn-block', className)}
        {...rest}
      >
        {loading ? (
          <span className="btn-spinner" aria-hidden="true" />
        ) : Icon ? (
          <Icon className="btn-icon-svg" aria-hidden="true" />
        ) : null}
        {children != null && <span className="btn-label">{children}</span>}
        {!loading && IconEnd ? <IconEnd className="btn-icon-svg" aria-hidden="true" /> : null}
      </button>
    );
  }

  return (
    <Component
      aria-disabled={isDisabled || undefined}
      className={cn('btn', VARIANTS[variant], SIZES[size], block && 'btn-block', isDisabled && 'btn--disabled', className)}
      {...rest}
    >
      {Icon ? <Icon className="btn-icon-svg" aria-hidden="true" /> : null}
      {children != null && <span className="btn-label">{children}</span>}
      {IconEnd ? <IconEnd className="btn-icon-svg" aria-hidden="true" /> : null}
    </Component>
  );
}

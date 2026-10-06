import { cn } from '../../lib/cn';

export default function Switch({ checked, onChange, disabled, label, id, className }) {
  const input = (
    <input
      type="checkbox"
      id={id}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
      className="sr-only"
      role="switch"
      aria-checked={checked}
    />
  );
  const track = (
    <span className="switch" aria-hidden="true">
      <span className="switch__knob" />
    </span>
  );

  if (label) {
    return (
      <label htmlFor={id} className={cn('switch-row', className)}>
        {input}
        {track}
        <span className="switch-row__label">{label}</span>
      </label>
    );
  }
  return (
    <span className={cn('inline-flex', className)}>
      {input}
      {track}
    </span>
  );
}

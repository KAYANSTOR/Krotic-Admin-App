import Switch from './Switch';

export default function SettingField({ label, hint, switch: switchProps, children }) {
  if (switchProps) {
    const { checked, onChange, disabled = false, id } = switchProps;
    return (
      <label
        className={`flex items-center justify-between gap-3 px-4 py-3 min-h-[56px] ${disabled ? 'opacity-60' : 'cursor-pointer'}`}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[var(--ui-ink)]">{label}</p>
          {hint && <p className="text-[11px] text-[var(--ui-muted)] mt-0.5 leading-relaxed">{hint}</p>}
        </div>
        <Switch
          id={id}
          checked={checked}
          onChange={onChange}
          disabled={disabled}
        />
      </label>
    );
  }

  return (
    <div className="px-4 py-3 space-y-1.5">
      <label className="text-xs font-bold text-[var(--ui-ink)] block">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-[var(--ui-muted)] leading-relaxed">{hint}</p>}
    </div>
  );
}

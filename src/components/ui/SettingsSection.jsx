export default function SettingsSection({ title, description, icon: Icon, children }) {
  return (
    <section className="rounded-2xl bg-[var(--ui-surface)] border border-line overflow-hidden">
      <header className="px-4 py-3 border-b border-line flex items-start gap-2.5">
        {Icon && (
          <span className="w-8 h-8 rounded-lg bg-brand/10 text-brand-deep flex items-center justify-center shrink-0">
            <Icon className="w-4 h-4" />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-black text-[var(--ui-ink)]">{title}</h3>
          {description && (
            <p className="text-[11px] text-[var(--ui-muted)] mt-0.5 leading-relaxed">{description}</p>
          )}
        </div>
      </header>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

import { AlertTriangle } from 'lucide-react';

export default function DangerZone({ title, description, icon: Icon, children }) {
  return (
    <section className="rounded-2xl bg-rose-50/50 border border-rose-200 overflow-hidden">
      <header className="px-4 py-3 border-b border-rose-200 flex items-start gap-2.5">
        <span className="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
          {Icon ? <Icon className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-black text-rose-900">{title}</h3>
          {description && (
            <p className="text-[11px] text-rose-700 mt-0.5 leading-relaxed">{description}</p>
          )}
        </div>
      </header>
      <div className="p-4 space-y-3">{children}</div>
    </section>
  );
}

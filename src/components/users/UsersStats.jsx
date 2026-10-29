import { formatNumber } from '../../lib/format';

const CARDS = [
  { key: 'total', label: 'إجمالي الشبكات', tone: 'brand', hint: 'حساب مسجل' },
  { key: 'active', label: 'حسابات نشطة', tone: 'success', hint: 'مفعّلة وتعمل' },
  { key: 'trial', label: 'حسابات تجريبية', tone: 'warning', hint: 'فترة تجريبية' },
  { key: 'blocked', label: 'محظورون / منتهية', tone: 'danger', hint: 'بحاجة لمتابعة' },
];

const TONE_CLASSES = {
  brand: 'text-brand-deep',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-rose-700',
};

export default function UsersStats({ stats }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5" aria-label="ملخص المستخدمين">
      {CARDS.map(({ key, label, tone, hint }) => (
        <div key={key} className="p-3.5 rounded-2xl bg-surface border border-line shadow-xs">
          <span className={`text-[11px] font-bold block mb-1 ${TONE_CLASSES[tone]}`}>
            {label}
          </span>
          <p className={`text-xl font-black font-mono ${TONE_CLASSES[tone]}`}>
            {formatNumber(key === 'blocked' ? stats.blocked + stats.expired : (stats[key] ?? 0))}
          </p>
          <span className="text-[10px] text-muted">{hint}</span>
        </div>
      ))}
    </div>
  );
}

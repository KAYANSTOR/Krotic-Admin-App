import { Power, PlayCircle, PauseCircle } from 'lucide-react';

export default function AppStatusHero({ active, onToggle, maintenanceMessage }) {
  const Icon = active ? PlayCircle : PauseCircle;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full text-right rounded-3xl p-5 active:scale-[0.98] transition-transform overflow-hidden relative ${
        active
          ? 'bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-lg shadow-emerald-500/20'
          : 'bg-gradient-to-br from-rose-500 to-rose-700 text-white shadow-lg shadow-rose-500/20'
      }`}
      aria-label={active ? 'إيقاف التطبيق' : 'تشغيل التطبيق'}
    >
      <div className="absolute top-0 left-0 w-32 h-32 rounded-full bg-white/5 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-40 h-40 rounded-full bg-black/10 translate-x-1/3 translate-y-1/3 pointer-events-none" />

      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-white/80 uppercase tracking-wider">حالة التطبيق</p>
            <p className="text-3xl font-black mt-1 leading-none">{active ? 'يعمل' : 'متوقف'}</p>
          </div>
          <span className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
            <Icon className="w-7 h-7" />
          </span>
        </div>

        <p className="text-xs text-white/85 mt-3 leading-relaxed">
          {active
            ? 'اضغط لإيقاف التطبيق وإظهار شاشة الصيانة لجميع المستخدمين'
            : 'اضغط لإعادة تشغيل التطبيق لجميع المستخدمين فوراً'}
        </p>

        {!active && maintenanceMessage && (
          <p className="text-[11px] text-white/70 mt-1.5 leading-relaxed line-clamp-2">
            <span className="font-bold text-white/90">رسالة الصيانة:</span> {maintenanceMessage}
          </p>
        )}
      </div>
    </button>
  );
}

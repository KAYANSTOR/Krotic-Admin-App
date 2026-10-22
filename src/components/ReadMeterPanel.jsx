import { useEffect, useState } from 'react';
import { readCounters, resetReadCounters, subscribeReadCounters } from '../lib/localDb/readMeter';

export default function ReadMeterPanel() {
  const [state, setState] = useState(readCounters);
  const enabled = new URLSearchParams(window.location.search).get('debug') === 'reads';

  useEffect(() => {
    if (!enabled) return undefined;
    return subscribeReadCounters(setState);
  }, [enabled]);

  if (!enabled) return null;

  const rows = Object.entries(state.byLabel).sort(([, first], [, second]) => second.reads - first.reads);

  return (
    <aside className="fixed bottom-3 left-3 z-[100] max-h-[70vh] w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-md border border-slate-300 bg-white text-slate-900 shadow-xl" dir="rtl">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-2">
        <div>
          <strong className="text-sm">تشخيص قراءات Firestore</strong>
          <div className="text-xs text-slate-600">تقدير من الواجهة، ليس بديلاً عن Usage</div>
        </div>
        <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs" onClick={resetReadCounters}>
          تصفير
        </button>
      </header>
      <div className="flex gap-4 border-b border-slate-200 px-3 py-2 text-xs">
        <span>القراءات: <b>{state.total}</b></span>
        <span>الاستدعاءات: <b>{state.calls}</b></span>
      </div>
      <div className="max-h-[52vh] overflow-auto">
        <table className="w-full text-right text-xs">
          <thead className="sticky top-0 bg-slate-100 text-slate-700">
            <tr><th className="px-3 py-2">المسار</th><th className="px-2 py-2">وثائق</th><th className="px-2 py-2">المصدر</th></tr>
          </thead>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label} className="border-t border-slate-100">
                <td className="max-w-[13rem] break-all px-3 py-2">{label}</td>
                <td className="px-2 py-2">{value.reads}</td>
                <td className="whitespace-nowrap px-2 py-2">خادم {value.serverReads} / كاش {value.cacheReads} / مجهول {value.unknownSourceReads}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="px-3 py-4 text-slate-500" colSpan={3}>لم تُرصد قراءات بعد.</td></tr>}
          </tbody>
        </table>
      </div>
    </aside>
  );
}
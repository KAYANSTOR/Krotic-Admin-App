import { useEffect, useState } from 'react';
import { Activity, X, RotateCcw } from 'lucide-react';
import {
  readCounters,
  subscribeReadCounters,
  resetReadCounters,
} from '../lib/localDb/readMeter';

/**
 * لوحة مراقبة قراءات Firestore — للمطور فقط.
 * تختفي في الإنتاج ولا تنفذ اشتراكاً أثناء التشغيل الإنتاجي.
 */
export default function ReadMeterPanel() {
  const [counters, setCounters] = useState(() => readCounters());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    return subscribeReadCounters(setCounters);
  }, []);

  if (!import.meta.env.DEV) return null;

  const { total, calls, byLabel } = counters;
  const labels = Object.entries(byLabel).sort((a, b) => b[1].reads - a[1].reads);

  return (
    <div
      style={{ position: 'fixed', insetInlineStart: 12, insetBlockEnd: 80, zIndex: 55, fontFamily: 'Tajawal, system-ui, sans-serif' }}
      aria-label="عداد قراءات Firestore"
    >
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={`Firestore Reads: ${total} (${calls} calls)`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            minHeight: 40, padding: '0 12px',
            border: '1px solid var(--ui-line, #E5DDD2)', borderRadius: 20,
            background: 'var(--ui-surface, #FFFFFF)', color: 'var(--ui-ink-soft, #4A3D34)',
            fontWeight: 700, fontSize: 12, cursor: 'pointer',
            boxShadow: '0 4px 12px -4px rgba(26,20,16,.15)',
          }}
        >
          <Activity size={14} /> {total} reads
        </button>
      ) : (
        <section
          style={{
            width: 280, maxHeight: '60vh', overflowY: 'auto',
            borderRadius: 16, border: '1px solid var(--ui-line, #E5DDD2)',
            background: 'var(--ui-surface, #FFFFFF)',
            boxShadow: '0 12px 32px -12px rgba(26,20,16,.25)',
          }}
          role="dialog"
          aria-modal="false"
          aria-label="لوحة قراءات Firestore"
        >
          <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--ui-line, #E5DDD2)' }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'var(--ui-ink, #1A1410)' }}>
              Firestore Reads
            </p>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                onClick={resetReadCounters}
                title="إعادة التصفير"
                style={{ display: 'inline-grid', placeItems: 'center', width: 32, height: 32, border: 0, borderRadius: 8, background: 'transparent', color: 'var(--ui-muted, #7A6B5F)', cursor: 'pointer' }}
              >
                <RotateCcw size={14} />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                title="إغلاق"
                style={{ display: 'inline-grid', placeItems: 'center', width: 32, height: 32, border: 0, borderRadius: 8, background: 'transparent', color: 'var(--ui-muted, #7A6B5F)', cursor: 'pointer' }}
              >
                <X size={14} />
              </button>
            </div>
          </header>
          <div style={{ padding: 12 }}>
            <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div>
                <dt style={{ fontSize: 11, color: 'var(--ui-muted)', fontWeight: 700 }}>Total Reads</dt>
                <dd style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'var(--ui-brand-deep)' }}>{total}</dd>
              </div>
              <div>
                <dt style={{ fontSize: 11, color: 'var(--ui-muted)', fontWeight: 700 }}>Calls</dt>
                <dd style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{calls}</dd>
              </div>
            </dl>
            <p style={{ fontSize: 11, color: 'var(--ui-muted)', fontWeight: 700, marginBottom: 6 }}>By Source</p>
            {labels.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--ui-muted)', margin: 0 }}>لا توجد قراءات بعد.</p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
                {labels.map(([label, entry]) => (
                  <li key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '4px 6px', borderRadius: 6, background: 'var(--ui-sunken, #EFEAE2)' }}>
                    <span style={{ fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160, color: 'var(--ui-ink-soft)' }} title={label}>{label}</span>
                    <strong style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ui-ink)' }}>{entry.reads}</strong>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

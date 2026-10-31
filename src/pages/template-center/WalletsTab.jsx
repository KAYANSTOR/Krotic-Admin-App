import { useMemo, useState, useEffect } from 'react';
import {
  Check, MessageSquare, Plus, Trash2, X, MoreVertical, Pencil,
} from 'lucide-react';
import DataCard from '../../components/ui/DataCard';
import FAB from '../../components/ui/FAB';
import OverflowMenu from '../../components/ui/OverflowMenu';
import DraftScopePanel from './DraftScopePanel';
import { useTemplateCenter } from './TemplateCenterContext';
import { BUNDLED_TEMPLATE_PACK } from '../../lib/bundledTemplatePack';
import { createMessageSourceId } from '../../lib/templateCenterIds';
import {
  MESSAGE_SOURCE_MODE_LABELS, MESSAGE_SOURCE_STATUS_LABELS,
  collectReleaseEntryIds, describeEntrySource,
} from '../../lib/templateCenterView';
import { Field, Input, Select } from '../../components/ui/Field';
import Button from '../../components/ui/Button';

function emptySource() {
  return {
    id: createMessageSourceId(),
    name: '',
    status: 'active',
    sourceMode: 'sms',
    senderId: '',
    packageName: '',
    createdAt: new Date().toISOString(),
  };
}

export default function WalletsTab() {
  const { payload, setSection, releases, working } = useTemplateCenter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState('');
  const [menuSource, setMenuSource] = useState(null);

  const sources = payload.wallets || [];
  const bundledIds = useMemo(() => new Set(BUNDLED_TEMPLATE_PACK.wallets.map((w) => w.id)), []);
  const releaseIds = useMemo(() => collectReleaseEntryIds(releases).wallets, [releases]);

  useEffect(() => {
    if (!sheetOpen) {
      setEntry(null);
      setError('');
    }
  }, [sheetOpen]);

  const update = (field, value) => setEntry((current) => ({ ...current, [field]: value }));

  const openNew = () => {
    setEntry(emptySource());
    setSheetOpen(true);
  };

  const openEdit = (source) => {
    setEntry({ ...source });
    setSheetOpen(true);
    setMenuSource(null);
  };

  const save = (event) => {
    event.preventDefault();
    if (!entry) return;

    if (entry.sourceMode === 'notification' && !entry.packageName?.trim()) {
      setError('حالة القراءة من الإشعارات تتطلب اسم حزمة Android (packageName).');
      return;
    }
    if (!entry.id?.trim() || !entry.name?.trim()) {
      setError('المعرّف والاسم مطلوبان.');
      return;
    }

    const next = {
      ...entry,
      id: entry.id.trim(),
      name: entry.name.trim(),
      senderId: entry.senderId?.trim() || null,
      packageName: entry.sourceMode === 'notification' ? entry.packageName.trim() : (entry.packageName?.trim() || null),
    };
    const index = sources.findIndex((s) => s.id === next.id);
    const updated = index < 0 ? [...sources, next] : sources.map((s, i) => (i === index ? next : s));
    setSection('wallets', updated);
    setSheetOpen(false);
  };

  const remove = (source) => {
    if (!window.confirm(`حذف مصدر الرسائل "${source.name || source.id}" من المسودة؟`)) return;
    setSection('wallets', sources.filter((s) => s.id !== source.id));
    setMenuSource(null);
  };

  return (
    <div className="space-y-3">
      <DraftScopePanel />

      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-black text-[var(--ui-ink)]">
          مصادر الرسائل ({sources.length})
        </h2>
        <span className="text-[11px] text-[var(--ui-muted)]">SMS أو إشعار تطبيق</span>
      </div>

      {sources.length === 0 ? (
        <div className="p-10 text-center rounded-2xl bg-[var(--ui-surface)] border border-line">
          <MessageSquare className="w-6 h-6 mx-auto mb-2 text-[var(--ui-muted)]" />
          <p className="font-bold text-[var(--ui-ink)]">لا توجد مصادر بعد</p>
          <p className="text-xs text-[var(--ui-muted)] mt-1">
            أضف مصدراً، أو استورد الكتالوج الافتراضي من زر المسودة.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {sources.map((source) => {
            const origin = describeEntrySource(source, { bundledIds, releaseIds });
            const modeLabel = MESSAGE_SOURCE_MODE_LABELS[source.sourceMode] || 'SMS';
            const statusLabel = MESSAGE_SOURCE_STATUS_LABELS[source.status] || source.status;

            return (
              <DataCard
                key={source.id}
                avatar={{ initial: (source.name || '?').charAt(0), tone: source.status === 'active' ? 'brand' : 'neutral' }}
                title={source.name || source.id}
                subtitle={source.senderId || source.packageName || source.id}
                badges={[
                  { label: modeLabel, tone: 'neutral' },
                  { label: statusLabel, tone: source.status === 'active' ? 'success' : 'warning' },
                  ...(origin.kind !== 'draft' ? [{ label: origin.label, tone: 'neutral' }] : []),
                ]}
                trailing={
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setMenuSource(source); }}
                    className="p-2 rounded-full text-[var(--ui-muted)] hover:bg-[var(--ui-sunken)] hover:text-[var(--ui-ink)]"
                    aria-label="إجراءات"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                }
                onClick={() => openEdit(source)}
              />
            );
          })}
        </div>
      )}

      <FAB icon={Plus} label="إضافة مصدر" extended onClick={openNew} />

      {/* Bottom Sheet — form */}
      {sheetOpen && entry && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setSheetOpen(false)}
            aria-hidden="true"
          />
          <form
            onSubmit={save}
            className="relative w-full max-w-lg bg-[var(--ui-surface)] rounded-t-3xl shadow-2xl flex flex-col max-h-[88dvh]"
          >
            <div className="w-9 h-1 rounded-full bg-[var(--ui-line-strong)] mx-auto mt-2 mb-1" />
            <header className="px-5 py-2.5 border-b border-line flex items-center justify-between">
              <h3 className="text-base font-black text-[var(--ui-ink)]">
                {sources.some((s) => s.id === entry.id) ? 'تعديل المصدر' : 'مصدر جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="p-2 rounded-full text-[var(--ui-muted)] hover:bg-[var(--ui-sunken)]"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              <Field label="معرّف مصدر الرسائل" hint="هوية ثابتة تُولَّد تلقائياً">
                <Input value={entry.id} readOnly disabled dir="ltr" />
              </Field>
              <Field label="الاسم" required>
                <Input value={entry.name} onChange={(e) => update('name', e.target.value)} required maxLength={120} />
              </Field>
              <Field label="الحالة">
                <Select value={entry.status} onChange={(e) => update('status', e.target.value)}>
                  {Object.entries(MESSAGE_SOURCE_STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </Select>
              </Field>
              <Field label="وضع القراءة">
                <Select value={entry.sourceMode || 'sms'} onChange={(e) => update('sourceMode', e.target.value)}>
                  {Object.entries(MESSAGE_SOURCE_MODE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </Select>
              </Field>
              <Field label="معرّف المرسل (senderId)">
                <Input value={entry.senderId || ''} onChange={(e) => update('senderId', e.target.value)} maxLength={120} dir="ltr" />
              </Field>
              {entry.sourceMode === 'notification' && (
                <Field label="اسم حزمة Android" required>
                  <Input
                    value={entry.packageName || ''}
                    onChange={(e) => update('packageName', e.target.value)}
                    required
                    maxLength={200}
                    placeholder="com.example.wallet"
                    dir="ltr"
                  />
                </Field>
              )}
              {error && (
                <p className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2" role="alert">
                  {error}
                </p>
              )}
            </div>
            <footer className="border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex gap-2">
              <Button variant="secondary" type="button" onClick={() => setSheetOpen(false)} className="flex-1">
                إلغاء
              </Button>
              <Button variant="primary" type="submit" icon={Check} className="flex-1">
                حفظ في المسودة
              </Button>
            </footer>
          </form>
        </div>
      )}

      <OverflowMenu
        isOpen={Boolean(menuSource)}
        onClose={() => setMenuSource(null)}
        title={menuSource?.name || menuSource?.id}
        subtitle={menuSource?.senderId || ''}
        actions={menuSource ? [
          { key: 'edit', icon: Pencil, label: 'تعديل', tone: 'brand', onClick: () => openEdit(menuSource) },
          { key: 'delete', icon: Trash2, label: 'حذف من المسودة', tone: 'danger', onClick: () => remove(menuSource) },
        ] : []}
      />
    </div>
  );
}

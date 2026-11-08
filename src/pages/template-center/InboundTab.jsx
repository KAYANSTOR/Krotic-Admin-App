import { useMemo, useState, useEffect } from 'react';
import {
  AlertCircle, ArrowDownToLine, Beaker, Check, Plus, Trash2, X,
  MoreVertical, Pencil,
} from 'lucide-react';
import Button from '../../components/ui/Button';
import DataCard from '../../components/ui/DataCard';
import FAB from '../../components/ui/FAB';
import OverflowMenu from '../../components/ui/OverflowMenu';
import SettingsSection from '../../components/ui/SettingsSection';
import SettingField from '../../components/ui/SettingField';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import DraftScopePanel from './DraftScopePanel';
import { useTemplateCenter } from './TemplateCenterContext';
import { BUNDLED_TEMPLATE_PACK } from '../../lib/bundledTemplatePack';
import { createInboundTemplateId } from '../../lib/templateCenterIds';
import {
  INBOUND_IDENTIFIER_LABELS,
  INBOUND_SIMULATION_REASON_LABELS,
  collectReleaseEntryIds,
  describeEntrySource,
  labelReason,
} from '../../lib/templateCenterView';

function emptyTemplate() {
  return {
    id: createInboundTemplateId(),
    name: '',
    pattern: '',
    sampleBody: '',
    senderCode: '',
    walletId: '',
    posId: '',
    identifierKind: 'phone',
    priority: 100,
    isActive: true,
    requireReference: false,
  };
}

export default function InboundTab() {
  const { payload, setSection, releases, working, simulateInbound } = useTemplateCenter();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState('');
  const [menuTemplate, setMenuTemplate] = useState(null);
  const [simulationBody, setSimulationBody] = useState('');
  const [simulationSender, setSimulationSender] = useState('');
  const [simulationResult, setSimulationResult] = useState(null);

  const templates = payload.transferTemplates || [];
  const bundledIds = useMemo(() => new Set(BUNDLED_TEMPLATE_PACK.transferTemplates.map((t) => t.id)), []);
  const releaseIds = useMemo(() => collectReleaseEntryIds(releases).transferTemplates, [releases]);

  // تنظيف: إعادة تعيين عند إغلاق Bottom Sheet
  useEffect(() => {
    if (!sheetOpen) {
      setEntry(null);
      setError('');
    }
  }, [sheetOpen]);

  const update = (field, value) => setEntry((current) => ({ ...current, [field]: value }));

  const openNew = () => {
    setEntry(emptyTemplate());
    setSheetOpen(true);
  };

  const openEdit = (template) => {
    setEntry({ ...template });
    setSheetOpen(true);
    setMenuTemplate(null);
  };

  const save = (event) => {
    event.preventDefault();
    if (!entry) return;

    const next = {
      ...entry,
      id: entry.id.trim(),
      name: entry.name.trim(),
      pattern: entry.pattern.trim(),
      priority: Number(entry.priority),
      walletId: entry.walletId || null,
      posId: entry.posId || null,
      senderCode: entry.senderCode?.trim() || null,
      sampleBody: entry.sampleBody?.trim() || null,
    };

    // تنظيف: تحقق قبل الحفظ بدل الرسائل المتفرقة
    if (!next.name) { setError('الاسم مطلوب.'); return; }
    if (!next.pattern) { setError('نمط الرسالة مطلوب.'); return; }
    if (!Number.isInteger(next.priority) || next.priority < 0 || next.priority > 9999) {
      setError('الأولوية يجب أن تكون بين 0 و9999.');
      return;
    }

    const index = templates.findIndex((t) => t.id === next.id);
    const updated = index < 0 ? [...templates, next] : templates.map((t, i) => (i === index ? next : t));
    setSection('transferTemplates', updated);
    setSheetOpen(false);
  };

  const remove = (template) => {
    if (!window.confirm(`حذف القالب "${template.name || template.id}" من المسودة؟`)) return;
    setSection('transferTemplates', templates.filter((t) => t.id !== template.id));
    setMenuTemplate(null);
  };

  const runSimulation = async (event) => {
    event.preventDefault();
    setSimulationResult(null);
    const response = await simulateInbound({ body: simulationBody, sender: simulationSender });
    if (response.ok) setSimulationResult(response.result);
  };

  return (
    <div className="space-y-3">
      <DraftScopePanel />

      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-black text-[var(--ui-ink)]">
          قوالب التحليل ({templates.length})
        </h2>
        <span className="text-[11px] text-[var(--ui-muted)]">رسائل واردة</span>
      </div>

      {templates.length === 0 ? (
        <div className="p-10 text-center rounded-2xl bg-[var(--ui-surface)] border border-line">
          <ArrowDownToLine className="w-6 h-6 mx-auto mb-2 text-[var(--ui-muted)]" />
          <p className="font-bold text-[var(--ui-ink)]">لا توجد قوالب بعد</p>
          <p className="text-xs text-[var(--ui-muted)] mt-1">
            أضف قالباً، أو استورد الكتالوج الافتراضي من زر المسودة.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {templates.map((template) => {
            const origin = describeEntrySource(template, { bundledIds, releaseIds });
            const kindLabel = INBOUND_IDENTIFIER_LABELS[template.identifierKind] || 'غير معروف';

            return (
              <DataCard
                key={template.id}
                avatar={{ initial: (template.name || '?').charAt(0), tone: template.isActive ? 'brand' : 'neutral' }}
                title={template.name || template.id}
                subtitle={template.pattern || '—'}
                badges={[
                  { label: kindLabel, tone: 'neutral' },
                  { label: template.isActive ? 'نشط' : 'معطل', tone: template.isActive ? 'success' : 'warning' },
                  ...(origin.kind !== 'draft' ? [{ label: origin.label, tone: 'neutral' }] : []),
                ]}
                facts={[
                  { label: 'أولوية', value: template.priority },
                  ...(template.senderCode ? [{ label: 'المرسل', value: template.senderCode }] : []),
                ]}
                trailing={
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setMenuTemplate(template); }}
                    className="p-2 rounded-full text-[var(--ui-muted)] hover:bg-[var(--ui-sunken)] hover:text-[var(--ui-ink)]"
                    aria-label="إجراءات"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                }
                onClick={() => openEdit(template)}
              />
            );
          })}
        </div>
      )}

      <FAB icon={Plus} label="قالب جديد" extended onClick={openNew} disabled={working} />

      {/* === قسم المحاكاة === */}
      <SettingsSection
        title="اختبار مطابقة قالب وارد"
        description="محاكاة على الخادم — لا ترسل رسالة ولا تنفذ أي عملية مالية."
        icon={Beaker}
      >
        <SettingField label="نص الرسالة التجريبي">
          <Textarea
            rows={3}
            value={simulationBody}
            onChange={(e) => setSimulationBody(e.target.value)}
            maxLength={4000}
            placeholder="مثال: استلمت مبلغ 200 YER من 770000002 رصيدك هو 1000"
          />
        </SettingField>
        <SettingField label="اسم أو رقم المرسل">
          <Input
            value={simulationSender}
            onChange={(e) => setSimulationSender(e.target.value)}
            maxLength={160}
            placeholder="Jawali"
          />
        </SettingField>
        <div className="px-4 py-3">
          <Button
            variant="secondary"
            icon={Beaker}
            loading={working}
            onClick={runSimulation}
            disabled={!simulationBody.trim()}
          >
            اختبار المطابقة
          </Button>
        </div>
        {simulationResult && (
          <div className={`mx-4 mb-3 rounded-xl border p-3 text-xs ${
            simulationResult.matched
              ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
              : 'border-amber-200 bg-amber-50 text-amber-950'
          }`} role="status">
            <p className="flex items-center gap-1.5 font-bold">
              {simulationResult.matched
                ? <><Check className="w-4 h-4" /> تطابق مع {simulationResult.templateName}</>
                : <><AlertCircle className="w-4 h-4" /> لم تتم المطابقة: {labelReason(INBOUND_SIMULATION_REASON_LABELS, simulationResult.reason)}</>}
            </p>
            {simulationResult.extracted && (
              <dl className="mt-2 grid grid-cols-2 gap-1.5">
                {Object.entries(simulationResult.extracted).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 bg-white/60 rounded px-2 py-1">
                    <dt className="font-semibold">{k}</dt>
                    <dd className="font-mono text-[11px]" dir="auto">{v == null ? '—' : String(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
      </SettingsSection>

      {/* === Bottom Sheet — form === */}
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
                {templates.some((t) => t.id === entry.id) ? 'تعديل القالب' : 'قالب جديد'}
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
              <Field label="معرّف القالب" hint="هوية ثابتة تُولَّد تلقائياً">
                <Input value={entry.id} readOnly disabled dir="ltr" />
              </Field>
              <Field label="الاسم" required>
                <Input value={entry.name} onChange={(e) => update('name', e.target.value)} required maxLength={120} />
              </Field>
              <Field label="نوع المعرّف">
                <Select value={entry.identifierKind} onChange={(e) => update('identifierKind', e.target.value)}>
                  {Object.entries(INBOUND_IDENTIFIER_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </Select>
              </Field>
              <Field label="نمط الرسالة" required hint="المتغيرات: {amount} {phone} {account} {ref} {qty} {dest}">
                <Input value={entry.pattern} onChange={(e) => update('pattern', e.target.value)} required maxLength={500} dir="auto" />
              </Field>
              <Field label="نص عينة للاختبار">
                <Input value={entry.sampleBody || ''} onChange={(e) => update('sampleBody', e.target.value)} maxLength={2000} dir="auto" />
              </Field>
              <Field label="مصدر الرسائل">
                <Select value={entry.walletId || ''} onChange={(e) => update('walletId', e.target.value)}>
                  <option value="">بدون تحديد</option>
                  {payload.wallets.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="رمز المرسل">
                <Input value={entry.senderCode || ''} onChange={(e) => update('senderCode', e.target.value)} maxLength={120} />
              </Field>
              <Field label="معرّف نقطة البيع (اختياري)">
                <Input value={entry.posId || ''} onChange={(e) => update('posId', e.target.value)} maxLength={128} />
              </Field>
              <Field label="الأولوية" hint="0-9999">
                <Input
                  type="number"
                  min="0"
                  max="9999"
                  value={entry.priority}
                  onChange={(e) => update('priority', e.target.value)}
                />
              </Field>
              <div className="flex flex-col gap-2 pt-1">
                <label className="flex min-h-[44px] items-center gap-2 text-sm font-bold text-[var(--ui-ink)]">
                  <input
                    type="checkbox"
                    checked={Boolean(entry.isActive)}
                    onChange={(e) => update('isActive', e.target.checked)}
                    className="w-4 h-4 accent-[var(--ui-brand)]"
                  />
                  قالب نشط
                </label>
                <label className="flex min-h-[44px] items-center gap-2 text-sm font-bold text-[var(--ui-ink)]">
                  <input
                    type="checkbox"
                    checked={Boolean(entry.requireReference)}
                    onChange={(e) => update('requireReference', e.target.checked)}
                    className="w-4 h-4 accent-[var(--ui-brand)]"
                  />
                  يتطلب رقم مرجع
                </label>
              </div>
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
        isOpen={Boolean(menuTemplate)}
        onClose={() => setMenuTemplate(null)}
        title={menuTemplate?.name || menuTemplate?.id}
        subtitle={INBOUND_IDENTIFIER_LABELS[menuTemplate?.identifierKind] || ''}
        actions={menuTemplate ? [
          { key: 'edit', icon: Pencil, label: 'تعديل', tone: 'brand', onClick: () => openEdit(menuTemplate) },
          { key: 'delete', icon: Trash2, label: 'حذف من المسودة', tone: 'danger', onClick: () => remove(menuTemplate) },
        ] : []}
      />
    </div>
  );
}

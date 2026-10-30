import { useMemo, useState, useEffect } from 'react';
import {
  AlertCircle, Check, Plus, Send, Trash2, X, MoreVertical, Pencil, Eye,
} from 'lucide-react';
import Button from '../../components/ui/Button';
import DataCard from '../../components/ui/DataCard';
import FAB from '../../components/ui/FAB';
import OverflowMenu from '../../components/ui/OverflowMenu';
import SettingsSection from '../../components/ui/SettingsSection';
import SettingField from '../../components/ui/SettingField';
import { Field, Select, Textarea } from '../../components/ui/Field';
import DraftScopePanel from './DraftScopePanel';
import { useTemplateCenter } from './TemplateCenterContext';
import {
  OUTBOUND_PREVIEW_REASON_LABELS,
  OUTBOUND_SCOPE_LABELS,
  collectReleaseEntryIds,
  describeEntrySource,
  labelReason,
  validateOutboundTemplate,
} from '../../lib/templateCenterView';

export default function OutboundTab() {
  const { payload, setSection, catalog, releases, working, previewOutbound } = useTemplateCenter();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState('');
  const [menuTemplate, setMenuTemplate] = useState(null);
  const [previewKey, setPreviewKey] = useState('');
  const [previewValues, setPreviewValues] = useState('{}');
  const [previewResult, setPreviewResult] = useState(null);

  const templates = payload.outboundTemplates || [];
  const catalogDefinitions = catalog?.outboundTemplates || [];
  const releaseIds = useMemo(() => collectReleaseEntryIds(releases).outboundTemplates, [releases]);
  const usedKeys = useMemo(() => new Set(templates.map((t) => t.key)), [templates]);

  // تنظيف: إعادة تعيين عند إغلاق الـ Sheet
  useEffect(() => {
    if (!sheetOpen) { setEntry(null); setError(''); }
  }, [sheetOpen]);

  const scopeOf = (key) => catalogDefinitions.find((d) => d.key === key)?.scope;
  const requiredOf = (key) => catalogDefinitions.find((d) => d.key === key)?.required || [];

  const emptyTemplate = () => {
    const key = catalogDefinitions.find((d) => !usedKeys.has(d.key))?.key || '';
    return { key, body: '' };
  };

  const update = (field, value) => setEntry((current) => ({ ...current, [field]: value }));

  const openNew = () => {
    setEntry(emptyTemplate());
    setSheetOpen(true);
  };

  const openEdit = (template) => {
    setEntry({ ...template });
    setSheetOpen(true);
    setMenuTemplate(null);
    setPreviewKey(template.key);
  };

  const save = (event) => {
    event.preventDefault();
    if (!entry) return;

    const validation = validateOutboundTemplate({ key: entry.key, body: entry.body, catalog });
    if (!validation.ok) {
      // تنظيف: ترجمة أخطاء التحقق إلى رسائل عربية
      const readable = validation.errors.map((code) => {
        if (code === 'empty_body') return 'نص الرسالة مطلوب.';
        if (code === 'unknown_key') return 'اختر مفتاح قالب معروفاً.';
        if (code.startsWith('unknown_variable:')) return `متغير غير معروف: ${code.split(':')[1]}.`;
        if (code.startsWith('required_variable_missing:')) return `المتغير المطلوب مفقود: ${code.split(':')[1]}.`;
        return code;
      });
      setError(readable.join(' '));
      return;
    }

    const index = templates.findIndex((t) => t.key === entry.key);
    const updated = index < 0 ? [...templates, entry] : templates.map((t, i) => (i === index ? entry : t));
    setSection('outboundTemplates', updated);
    setSheetOpen(false);
  };

  const remove = (template) => {
    if (!window.confirm(`حذف قالب الرسالة "${template.key}" من المسودة؟`)) return;
    setSection('outboundTemplates', templates.filter((t) => t.key !== template.key));
    setMenuTemplate(null);
  };

  const runPreview = async (event) => {
    event.preventDefault();
    const selected = templates.find((t) => t.key === previewKey);
    if (!selected) {
      setPreviewResult({ ok: false, reason: 'اختر قالباً محفوظاً في المسودة أولاً' });
      return;
    }
    let values;
    try {
      values = JSON.parse(previewValues);
    } catch {
      setPreviewResult({ ok: false, reason: 'قيم المعاينة يجب أن تكون JSON صحيحًا' });
      return;
    }
    setPreviewResult(null);
    const response = await previewOutbound({ template: selected, values });
    if (response.ok) setPreviewResult(response.result);
  };

  const catalogEmpty = catalogDefinitions.length === 0;

  return (
    <div className="space-y-3">
      <DraftScopePanel />

      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-black text-[var(--ui-ink)]">
          الرسائل الصادرة ({templates.length})
        </h2>
        <span className="text-[11px] text-[var(--ui-muted)]">SMS</span>
      </div>

      {templates.length === 0 ? (
        <div className="p-10 text-center rounded-2xl bg-[var(--ui-surface)] border border-line">
          <Send className="w-6 h-6 mx-auto mb-2 text-[var(--ui-muted)]" />
          <p className="font-bold text-[var(--ui-ink)]">لا توجد رسائل صادرة</p>
          <p className="text-xs text-[var(--ui-muted)] mt-1">
            أضف قالباً، أو استورد الكتالوج الافتراضي من زر المسودة.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {templates.map((template) => {
            const origin = describeEntrySource(template, { releaseIds });
            const scope = scopeOf(template.key);
            const scopeLabel = OUTBOUND_SCOPE_LABELS[scope] || 'غير معروف';

            return (
              <DataCard
                key={template.key}
                avatar={{ initial: (template.key || '?').charAt(0).toUpperCase(), tone: 'brand' }}
                title={template.key}
                subtitle={template.body || '—'}
                badges={[
                  { label: scopeLabel, tone: 'neutral' },
                  ...(origin.kind !== 'draft' ? [{ label: origin.label, tone: 'brand' }] : []),
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

      <FAB
        icon={Plus}
        label="قالب جديد"
        extended
        onClick={openNew}
        disabled={working || catalogEmpty || templates.length >= catalogDefinitions.length}
      />

      {/* === قسم المعاينة === */}
      <SettingsSection
        title="معاينة رسالة صادرة"
        description="تتحقق من النطاق والمتغيرات دون إرسال SMS أو إشعار."
        icon={Eye}
      >
        <SettingField label="القالب">
          <Select value={previewKey} onChange={(e) => setPreviewKey(e.target.value)}>
            <option value="">اختر قالباً</option>
            {templates.map((t) => (
              <option key={t.key} value={t.key}>{t.key}</option>
            ))}
          </Select>
        </SettingField>
        <SettingField label="قيم المتغيرات (JSON)" hint='مثال: {"amount": "1500", "pos_name": "شبكة"}'>
          <Textarea
            rows={4}
            value={previewValues}
            onChange={(e) => setPreviewValues(e.target.value)}
            dir="ltr"
            className="font-mono text-xs"
          />
        </SettingField>
        <div className="px-4 py-3">
          <Button
            variant="secondary"
            icon={Send}
            loading={working}
            disabled={!previewKey}
            onClick={runPreview}
          >
            معاينة فقط
          </Button>
        </div>
        {previewResult && (
          <div className={`mx-4 mb-3 rounded-xl border p-3 text-xs ${
            previewResult.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
              : 'border-amber-200 bg-amber-50 text-amber-950'
          }`} role="status">
            <p className="flex items-center gap-1.5 font-bold">
              {previewResult.ok
                ? <><Check className="w-4 h-4" /> معاينة الرسالة</>
                : <><AlertCircle className="w-4 h-4" /> تعذرت المعاينة: {labelReason(OUTBOUND_PREVIEW_REASON_LABELS, previewResult.reason)}</>}
            </p>
            {previewResult.preview && (
              <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white/70 p-2 font-mono" dir="auto">
                {previewResult.preview}
              </p>
            )}
            {previewResult.variables?.length > 0 && (
              <p className="mt-2">القيم المطلوبة: {previewResult.variables.join('، ')}</p>
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
                {templates.some((t) => t.key === entry.key) ? 'تعديل القالب' : 'قالب جديد'}
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
              <Field label="مفتاح القالب" hint="المفاتيح المعروفة فقط من كتالوج الخادم.">
                <Select
                  value={entry.key}
                  onChange={(e) => { update('key', e.target.value); setPreviewKey(e.target.value); }}
                >
                  {catalogDefinitions.map((item) => (
                    <option key={item.key} value={item.key} disabled={usedKeys.has(item.key) && item.key !== entry.key}>
                      {item.key} — {OUTBOUND_SCOPE_LABELS[item.scope] || '—'}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="نص الرسالة"
                hint={`المتغيرات المطلوبة: ${requiredOf(entry.key).join('، ') || 'لا يوجد'}. الصيغتان {name} و%name مدعوتان.`}
              >
                <Textarea
                  rows={5}
                  value={entry.body}
                  onChange={(e) => update('body', e.target.value)}
                  required
                  maxLength={2000}
                  dir="auto"
                />
              </Field>
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
        title={menuTemplate?.key}
        subtitle={OUTBOUND_SCOPE_LABELS[scopeOf(menuTemplate?.key)] || ''}
        actions={menuTemplate ? [
          { key: 'edit', icon: Pencil, label: 'تعديل', tone: 'brand', onClick: () => openEdit(menuTemplate) },
          { key: 'delete', icon: Trash2, label: 'حذف من المسودة', tone: 'danger', onClick: () => remove(menuTemplate) },
        ] : []}
      />
    </div>
  );
}

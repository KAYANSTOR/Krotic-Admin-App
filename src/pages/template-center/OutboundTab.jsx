import { useMemo, useState } from 'react';
import { AlertCircle, Check, Plus, Send, Trash2, X } from 'lucide-react';
import Section from '../../components/ui/Section';
import { Card, CardHeader } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import { Field, Select, Textarea } from '../../components/ui/Field';
import DraftScopePanel from './DraftScopePanel';
import { useTemplateCenter } from './TemplateCenterContext';
import { collectReleaseEntryIds, describeEntrySource, validateOutboundTemplate } from '../../lib/templateCenterView';

const SCOPE_LABELS = {
  outboundCustomer: 'رسائل العملاء',
  outboundPos: 'نقاط البيع',
  outboundSystem: 'رسائل النظام',
};

/**
 * تبويب الرسائل الصادرة (SMS). منفصل تمامًا عن `/notifications` (إشعارات FCM).
 * المعاينة لا ترسل SMS ولا FCM ولا تسجّل أي أثر مالي.
 */
export default function OutboundTab() {
  const { payload, setSection, catalog, releases, working, previewOutbound } = useTemplateCenter();
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState('');
  const [previewKey, setPreviewKey] = useState('');
  const [previewValues, setPreviewValues] = useState('{}');
  const [previewResult, setPreviewResult] = useState(null);

  const templates = payload.outboundTemplates || [];
  const catalogDefinitions = catalog?.outboundTemplates || [];
  const releaseIds = useMemo(() => collectReleaseEntryIds(releases).outboundTemplates, [releases]);
  const usedKeys = useMemo(() => new Set(templates.map((item) => item.key)), [templates]);

  const scopeOf = (key) => catalogDefinitions.find((item) => item.key === key)?.scope;
  const requiredOf = (key) => catalogDefinitions.find((item) => item.key === key)?.required || [];

  const emptyTemplate = () => {
    const key = catalogDefinitions.find((item) => !usedKeys.has(item.key))?.key || '';
    return { key, body: '' };
  };

  const update = (field, value) => setEntry((current) => ({ ...current, [field]: value }));

  const save = (event) => {
    event.preventDefault();
    if (!entry) return;
    const validation = validateOutboundTemplate({ key: entry.key, body: entry.body, catalog });
    if (!validation.ok) {
      const readable = validation.errors.map((code) => {
        if (code === 'empty_body') return 'نص الرسالة مطلوب.';
        if (code === 'unknown_key') return 'اختر مفتاح قالب معروفًا.';
        if (code.startsWith('unknown_variable:')) return `متغير غير معروف: ${code.split(':')[1]}.`;
        if (code.startsWith('required_variable_missing:')) return `المتغير المطلوب مفقود: ${code.split(':')[1]}.`;
        return code;
      });
      setError(readable.join(' '));
      return;
    }
    const index = templates.findIndex((item) => item.key === entry.key);
    const updated = index < 0 ? [...templates, entry] : templates.map((item, i) => (i === index ? entry : item));
    setSection('outboundTemplates', updated);
    setEntry(null);
    setError('');
  };

  const remove = (template) => {
    if (!window.confirm(`حذف قالب الرسالة "${template.key}" من المسودة؟`)) return;
    setSection('outboundTemplates', templates.filter((item) => item.key !== template.key));
    if (entry?.key === template.key) setEntry(null);
  };

  const runPreview = async (event) => {
    event.preventDefault();
    const selected = templates.find((item) => item.key === previewKey);
    if (!selected) {
      setPreviewResult({ ok: false, reason: 'اختر قالبًا محفوظًا في المسودة أولًا' });
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

  return (
    <Section
      title="الرسائل الصادرة (SMS)"
      description="قوالب نصية يرسلها تطبيق Android للعملاء ونقاط البيع. مسار منفصل عن إشعارات FCM في صفحة /notifications."
    >
      <DraftScopePanel />

      <div className="mt-4 rounded-xl border border-stone-200 bg-white p-4 shadow-xs">
        <p className="font-bold text-stone-900 flex items-center gap-2 text-sm mb-2">
          <Send className="h-4 w-4 text-brand-600" aria-hidden="true" />
          <span>دليل الاستخدام: ماذا سوف يحدث في شاشة الرسائل الصادرة (SMS)؟</span>
        </p>
        <div className="grid gap-3 sm:grid-cols-3 text-xs leading-5 text-stone-600">
          <div className="rounded-lg bg-stone-50 p-3 border border-stone-200/60">
            <strong className="text-stone-900 block font-bold mb-1">١. تخصيص رسائل SMS</strong>
            تحدد صيغ الرسائل النصية القصيرة التي يرسلها هاتف نقطة البيع أو التطبيق (مثل إشعار تسليم الكرت أو تنبيه الرصيد) عبر شريحة SIM الخاصة بالهاتف.
          </div>
          <div className="rounded-lg bg-stone-50 p-3 border border-stone-200/60">
            <strong className="text-stone-900 block font-bold mb-1">٢. المعاينة الآمنة</strong>
            أداة المعاينة أدناه تتيح لك اختبار دمج المتغيرات النصية لمعاينة شكل الرسالة النهائي قبل الاعتماد. لا تُرسَل أي رسالة ولا تستهلك أي رصيد.
          </div>
          <div className="rounded-lg bg-stone-50 p-3 border border-stone-200/60">
            <strong className="text-stone-900 block font-bold mb-1">٣. مسار منفصل تماماً</strong>
            هذا القسم منفصل كلياً عن إشعارات التطبيق (FCM) في صفحة /notifications؛ فهنا نتحكم بقوالب SMS الهاتفية فقط.
          </div>
        </div>
      </div>

      <Card className="mt-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold">قوالب الرسائل الصادرة في المسودة ({templates.length})</h2>
          <Button icon={Plus} disabled={Boolean(entry) || templates.length >= catalogDefinitions.length} onClick={() => { setEntry(emptyTemplate()); setError(''); }}>إضافة قالب</Button>
        </div>

        {entry && (
          <form onSubmit={save} className="mb-5 mt-4 grid gap-4 rounded-2xl border border-stone-200 bg-stone-50 p-4">
            <Field label="مفتاح القالب" htmlFor="outbound-key" hint="المفاتيح المعروفة فقط من كتالوج الخادم.">
              <Select
                id="outbound-key"
                value={entry.key}
                onChange={(event) => { update('key', event.target.value); setPreviewKey(event.target.value); }}
              >
                {catalogDefinitions.map((item) => (
                  <option key={item.key} value={item.key} disabled={usedKeys.has(item.key) && item.key !== entry.key}>
                    {item.key} — {SCOPE_LABELS[item.scope] || item.scope}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="نص الرسالة"
              htmlFor="outbound-body"
              hint={`المتغيرات المطلوبة: ${requiredOf(entry.key).join('، ') || 'لا يوجد'}. الصيغتان {name} و%name مدعوتان.`}
            >
              <Textarea id="outbound-body" rows={4} value={entry.body} onChange={(event) => update('body', event.target.value)} required maxLength={2000} className="min-h-28" />
            </Field>
            {error && <p className="text-sm font-semibold text-red-700" role="alert">{error}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" icon={Check}>حفظ القالب في المسودة</Button>
              <Button variant="secondary" icon={X} onClick={() => { setEntry(null); setError(''); }}>إلغاء</Button>
            </div>
          </form>
        )}

        {templates.length === 0 ? (
          <EmptyState icon={Send} title="لا توجد رسائل صادرة في المسودة" description="أضف قوالب، أو استورد كتالوج زرع Android. القائمة الفارغة لا تعني عدم وجود قوالب على الأجهزة." />
        ) : (
          <ul className="mt-4 divide-y divide-stone-100">
            {templates.map((template) => {
              const source = describeEntrySource(template, { releaseIds });
              return (
                <li key={template.key} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-sm font-bold text-stone-900" dir="ltr">{template.key}</p>
                      <Badge tone="brand">{SCOPE_LABELS[scopeOf(template.key)] || 'غير معروف'}</Badge>
                      <Badge tone={source.kind === 'release' ? 'brand' : 'neutral'}>{source.label}</Badge>
                    </div>
                    <p className="mt-1 break-words text-sm text-stone-600" dir="auto">{template.body}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => { setEntry({ ...template }); setPreviewKey(template.key); setError(''); }}>تعديل</Button>
                    <Button size="sm" variant="danger" icon={Trash2} aria-label={`حذف ${template.key}`} disabled={working} onClick={() => remove(template)}>حذف</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="mt-4 p-4">
        <CardHeader title="معاينة رسالة صادرة" icon={Send} description="تتحقق من النطاق والمتغيرات دون إرسال SMS أو إشعار ودون أي أثر مالي." />
        <form onSubmit={runPreview} className="mt-4 space-y-4">
          <Field label="القالب" htmlFor="preview-template">
            <Select id="preview-template" value={previewKey} onChange={(event) => setPreviewKey(event.target.value)}>
              <option value="">اختر قالبًا</option>
              {templates.map((item) => <option key={item.key} value={item.key}>{item.key}</option>)}
            </Select>
          </Field>
          <Field label="قيم المتغيرات (JSON)" htmlFor="preview-values" hint='مثال: {"amount": "1500", "pos_name": "شبكة تجريبية"}'>
            <Textarea id="preview-values" rows={4} value={previewValues} onChange={(event) => setPreviewValues(event.target.value)} />
          </Field>
          <Button type="submit" icon={Send} loading={working}>معاينة فقط</Button>
          {previewResult && (
            <div className={`rounded-xl border p-4 ${previewResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : 'border-amber-200 bg-amber-50 text-amber-950'}`} role="status">
              <div className="flex items-center gap-2 font-bold">
                {previewResult.ok ? <Check className="h-4 w-4" aria-hidden="true" /> : <AlertCircle className="h-4 w-4" aria-hidden="true" />}
                {previewResult.ok ? 'معاينة الرسالة' : `تعذرت المعاينة: ${previewResult.reason}`}
              </div>
              {previewResult.preview && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-white/70 p-3" dir="auto">{previewResult.preview}</p>}
              {previewResult.variables?.length > 0 && <p className="mt-2 text-sm">القيم المطلوبة: {previewResult.variables.join('، ')}</p>}
              <p className="mt-2 text-xs">معاينة فقط — لا تُرسَل أي رسالة، ولم تُسجَّل أي عملية.</p>
            </div>
          )}
        </form>
      </Card>
    </Section>
  );
}

import { useMemo, useState } from 'react';
import { AlertCircle, ArrowDownToLine, Beaker, Check, Plus, Trash2, X } from 'lucide-react';
import Section from '../../components/ui/Section';
import { Card, CardHeader } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import DraftScopePanel from './DraftScopePanel';
import { useTemplateCenter } from './TemplateCenterContext';
import { BUNDLED_TEMPLATE_PACK } from '../../lib/bundledTemplatePack';
import { collectReleaseEntryIds, describeEntrySource } from '../../lib/templateCenterView';

const IDENTIFIER_LABELS = {
  phone: 'رقم هاتف',
  alternativeNumber: 'رقم بديل',
  account: 'رقم حساب',
  senderNameOnly: 'اسم المرسل فقط',
  balanceRequestCode: 'كود طلب رصيد',
};

function makeId() {
  return `template-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyTemplate() {
  return {
    id: makeId(), name: '', pattern: '', sampleBody: '', senderCode: '', walletId: '',
    posId: '', identifierKind: 'phone', priority: 100, isActive: true, requireReference: false,
  };
}

/**
 * تبويب قوالب التحويل الواردة (تحليل الرسائل). منفصل تمامًا عن الرسائل الصادرة
 * وعن إشعارات FCM. يتضمن محاكاة مطابقة على الخادم بلا أي أثر مالي.
 */
export default function InboundTab() {
  const { payload, setSection, releases, working, simulateInbound } = useTemplateCenter();
  const [entry, setEntry] = useState(null);
  const [simulationBody, setSimulationBody] = useState('');
  const [simulationSender, setSimulationSender] = useState('');
  const [simulationResult, setSimulationResult] = useState(null);

  const templates = payload.transferTemplates || [];
  const bundledIds = useMemo(() => new Set(BUNDLED_TEMPLATE_PACK.transferTemplates.map((item) => item.id)), []);
  const releaseIds = useMemo(() => collectReleaseEntryIds(releases).transferTemplates, [releases]);

  const update = (field, value) => setEntry((current) => ({ ...current, [field]: value }));

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
    const index = templates.findIndex((item) => item.id === next.id);
    const updated = index < 0 ? [...templates, next] : templates.map((item, i) => (i === index ? next : item));
    setSection('transferTemplates', updated);
    setEntry(null);
  };

  const remove = (template) => {
    if (!window.confirm(`حذف القالب "${template.name || template.id}" من المسودة؟`)) return;
    setSection('transferTemplates', templates.filter((item) => item.id !== template.id));
    if (entry?.id === template.id) setEntry(null);
  };

  const runSimulation = async (event) => {
    event.preventDefault();
    setSimulationResult(null);
    const response = await simulateInbound({ body: simulationBody, sender: simulationSender });
    if (response.ok) setSimulationResult(response.result);
  };

  return (
    <Section
      title="قوالب التحويل الواردة"
      description="قوالب تحليل رسائل التحويل الواردة، مربوطة بمحفظة و/أو نقطة بيع. قالب تحليل نصي محلي — ليس قالب SMS صادر وليس إشعار FCM."
    >
      <DraftScopePanel />

      <div className="mt-4 rounded-xl border border-stone-200 bg-white p-4 shadow-xs">
        <p className="font-bold text-stone-900 flex items-center gap-2 text-sm mb-2">
          <ArrowDownToLine className="h-4 w-4 text-brand-600" aria-hidden="true" />
          <span>دليل الاستخدام: ماذا سوف يحدث في شاشة قوالب التحويل الواردة؟</span>
        </p>
        <div className="grid gap-3 sm:grid-cols-3 text-xs leading-5 text-stone-600">
          <div className="rounded-lg bg-stone-50 p-3 border border-stone-200/60">
            <strong className="text-stone-900 block font-bold mb-1">١. تحليل الرسائل الواردة</strong>
            تحدد هذه القوالب النصوص والأنماط التي يطابقها تطبيق Android عند استلام حوالة (مثل الكريمي، النجم، جيب، جوالي) لاستخراج المبلغ ورقم الهاتف والرقم المرجعي آلياً.
          </div>
          <div className="rounded-lg bg-stone-50 p-3 border border-stone-200/60">
            <strong className="text-stone-900 block font-bold mb-1">٢. محاكاة المطابقة والتجربة</strong>
            صندوق الاختبار أدناه يتيح لك تجربة نص رسالة حقيقية والتحقق من صحة القالب فورياً في المتصفح. المحاكاة تجريبية بالكامل وبدون أي أثر مالي.
          </div>
          <div className="rounded-lg bg-stone-50 p-3 border border-stone-200/60">
            <strong className="text-stone-900 block font-bold mb-1">٣. التطبيق على الهواتف</strong>
            القوالب المضافة تبقى داخل المسودة؛ وعند الضغط على «حفظ المسودة» ثم «نشر إصدار»، تستلمها هواتف Android عند اتصالها ليقوم محرك التحليل بالعمل بها.
          </div>
        </div>
      </div>

      <Card className="mt-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold">القوالب في المسودة ({templates.length})</h2>
          <Button icon={Plus} disabled={Boolean(entry)} onClick={() => setEntry(emptyTemplate())}>إضافة قالب</Button>
        </div>

        {entry && (
          <form onSubmit={save} className="mb-5 mt-4 grid gap-4 rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:grid-cols-2">
            <Field label="معرّف القالب" htmlFor="inbound-id" required>
              <Input id="inbound-id" value={entry.id} onChange={(event) => update('id', event.target.value)} required maxLength={128} disabled={templates.some((item) => item.id === entry.id)} />
            </Field>
            <Field label="الاسم" htmlFor="inbound-name" required>
              <Input id="inbound-name" value={entry.name} onChange={(event) => update('name', event.target.value)} required maxLength={120} />
            </Field>
            <Field label="نوع المعرّف" htmlFor="inbound-kind">
              <Select id="inbound-kind" value={entry.identifierKind} onChange={(event) => update('identifierKind', event.target.value)}>
                {Object.entries(IDENTIFIER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
            <Field label="نمط الرسالة" htmlFor="inbound-pattern" required hint="استخدم {amount} و{phone} أو {account} و{ref} و{qty} و{dest}.">
              <Input id="inbound-pattern" value={entry.pattern} onChange={(event) => update('pattern', event.target.value)} required maxLength={500} />
            </Field>
            <Field label="نص عينة للاختبار" htmlFor="inbound-sample">
              <Input id="inbound-sample" value={entry.sampleBody || ''} onChange={(event) => update('sampleBody', event.target.value)} maxLength={2000} />
            </Field>
            <Field label="المحفظة" htmlFor="inbound-wallet">
              <Select id="inbound-wallet" value={entry.walletId || ''} onChange={(event) => update('walletId', event.target.value)}>
                <option value="">بدون تحديد</option>
                {payload.wallets.map((wallet) => <option value={wallet.id} key={wallet.id}>{wallet.name}</option>)}
              </Select>
            </Field>
            <Field label="رمز المرسل" htmlFor="inbound-sender">
              <Input id="inbound-sender" value={entry.senderCode || ''} onChange={(event) => update('senderCode', event.target.value)} maxLength={120} />
            </Field>
            <Field label="معرّف نقطة البيع (اختياري)" htmlFor="inbound-pos">
              <Input id="inbound-pos" value={entry.posId || ''} onChange={(event) => update('posId', event.target.value)} maxLength={128} />
            </Field>
            <Field label="الأولوية" htmlFor="inbound-priority">
              <Input id="inbound-priority" type="number" min="0" max="9999" value={entry.priority} onChange={(event) => update('priority', event.target.value)} />
            </Field>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={Boolean(entry.isActive)} onChange={(event) => update('isActive', event.target.checked)} /> قالب نشط
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={Boolean(entry.requireReference)} onChange={(event) => update('requireReference', event.target.checked)} /> يتطلب رقم مرجع
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <Button type="submit" icon={Check}>حفظ القالب في المسودة</Button>
              <Button variant="secondary" icon={X} onClick={() => setEntry(null)}>إلغاء</Button>
            </div>
          </form>
        )}

        {templates.length === 0 ? (
          <EmptyState icon={ArrowDownToLine} title="لا توجد قوالب تحويل واردة في المسودة" description="أضف قوالب، أو استورد كتالوج زرع Android إلى المسودة. القائمة الفارغة هنا لا تعني عدم وجود قوالب على الأجهزة." />
        ) : (
          <ul className="mt-4 divide-y divide-stone-100">
            {templates.map((template) => {
              const source = describeEntrySource(template, { bundledIds, releaseIds });
              return (
                <li key={template.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-stone-900" dir="auto">{template.name || template.id}</p>
                      <Badge tone="neutral">{IDENTIFIER_LABELS[template.identifierKind] || template.identifierKind}</Badge>
                      <Badge tone={template.isActive ? 'success' : 'warning'}>{template.isActive ? 'نشط' : 'معطل'}</Badge>
                      <Badge tone={source.kind === 'bundled' ? 'info' : source.kind === 'release' ? 'brand' : 'neutral'}>{source.label}</Badge>
                    </div>
                    <p className="mt-1 break-words text-sm text-stone-600" dir="auto">{template.pattern}</p>
                    <p className="mt-1 text-xs text-stone-500">
                      أولوية {template.priority}{template.walletId ? ` · محفظة ${template.walletId}` : ''}{template.posId ? ` · نقطة بيع ${template.posId}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEntry({ ...template })}>تعديل</Button>
                    <Button size="sm" variant="danger" icon={Trash2} aria-label={`حذف ${template.name || template.id}`} disabled={working} onClick={() => remove(template)}>حذف</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="mt-4 p-4">
        <CardHeader title="محاكاة مطابقة قالب وارد" icon={Beaker} description="محاكاة على الخادم للتحقق فقط؛ لا ترسل رسالة ولا تنفذ أي عملية مالية." />
        <form onSubmit={runSimulation} className="mt-4 space-y-4">
          <Field label="نص الرسالة التجريبي" htmlFor="simulate-body" required>
            <Textarea id="simulate-body" rows={3} value={simulationBody} onChange={(event) => setSimulationBody(event.target.value)} maxLength={4000} required />
          </Field>
          <Field label="اسم أو رقم المرسل" htmlFor="simulate-sender">
            <Input id="simulate-sender" value={simulationSender} onChange={(event) => setSimulationSender(event.target.value)} maxLength={160} />
          </Field>
          <Button type="submit" icon={Beaker} loading={working}>اختبار المطابقة</Button>
          {simulationResult && (
            <div className={`rounded-xl border p-4 ${simulationResult.matched ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : 'border-amber-200 bg-amber-50 text-amber-950'}`} role="status">
              <div className="flex items-center gap-2 font-bold">
                {simulationResult.matched ? <Check className="h-4 w-4" aria-hidden="true" /> : <AlertCircle className="h-4 w-4" aria-hidden="true" />}
                {simulationResult.matched ? `تطابق مع ${simulationResult.templateName}` : `لم تتم المطابقة: ${simulationResult.reason || 'لا يوجد قالب مطابق'}`}
              </div>
              {simulationResult.extracted && (
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  {Object.entries(simulationResult.extracted).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-3 rounded-lg bg-white/70 px-3 py-2">
                      <dt className="font-semibold">{key}</dt><dd dir="auto">{value == null ? '—' : String(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="mt-2 text-xs">محاكاة فقط — لا تنفّذ إيداعًا أو معالجة مالية.</p>
            </div>
          )}
        </form>
      </Card>
    </Section>
  );
}

import { useMemo, useState } from 'react';
import { Check, MessageSquare, Plus, Trash2, X } from 'lucide-react';
import Section from '../../components/ui/Section';
import { Card } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import { Field, Input, Select } from '../../components/ui/Field';
import DraftScopePanel from './DraftScopePanel';
import { useTemplateCenter } from './TemplateCenterContext';
import { BUNDLED_TEMPLATE_PACK } from '../../lib/bundledTemplatePack';
import { createMessageSourceId } from '../../lib/templateCenterIds';
import {
  MESSAGE_SOURCE_MODE_LABELS, MESSAGE_SOURCE_STATUS_LABELS,
  collectReleaseEntryIds, describeEntrySource,
} from '../../lib/templateCenterView';

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

/**
 * تبويب مصادر الرسائل (جدول Android `wallets`). يعرض ويحرّر تعريف المصدر فقط
 * (الاسم، senderId، mode، packageName، الحالة) — بلا أي حقل رصيد أو مالي.
 * المعرّف يُولَّد في اللوحة ويُعرض للقراءة فقط: هوية ثابتة لا يختارها المدير.
 */
export default function WalletsTab() {
  const { payload, setSection, releases, working } = useTemplateCenter();
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState('');

  const sources = payload.wallets || [];
  const bundledIds = useMemo(() => new Set(BUNDLED_TEMPLATE_PACK.wallets.map((wallet) => wallet.id)), []);
  const releaseIds = useMemo(() => collectReleaseEntryIds(releases).wallets, [releases]);

  const update = (field, value) => setEntry((current) => ({ ...current, [field]: value }));

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
    const index = sources.findIndex((source) => source.id === next.id);
    const updated = index < 0 ? [...sources, next] : sources.map((source, i) => (i === index ? next : source));
    setSection('wallets', updated);
    setEntry(null);
    setError('');
  };

  const remove = (source) => {
    if (!window.confirm(`حذف مصدر الرسائل "${source.name || source.id}" من المسودة؟`)) return;
    setSection('wallets', sources.filter((item) => item.id !== source.id));
    if (entry?.id === source.id) setEntry(null);
  };

  return (
    <Section
      title="مصادر الرسائل"
      description="هوية مصدر الرسائل (SMS أو إشعار تطبيق) وبياناته التي يستخدمها Android لربط الرسالة بالقالب. لا رصيد ولا حقول مالية في هذا النموذج."
    >
      <DraftScopePanel />

      <Card className="mt-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold">مصادر الرسائل في المسودة ({sources.length})</h2>
          <Button icon={Plus} disabled={Boolean(entry)} onClick={() => { setEntry(emptySource()); setError(''); }}>إضافة مصدر</Button>
        </div>

        {entry && (
          <form onSubmit={save} className="mb-5 mt-4 grid gap-4 rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:grid-cols-2">
            <Field label="معرّف مصدر الرسائل" htmlFor="wallet-id" hint="هوية ثابتة تُولَّد تلقائيًا ولا تتغيّر بعد الحفظ.">
              <Input id="wallet-id" value={entry.id} readOnly disabled dir="ltr" />
            </Field>
            <Field label="الاسم" htmlFor="wallet-name" required>
              <Input id="wallet-name" value={entry.name} onChange={(event) => update('name', event.target.value)} required maxLength={120} />
            </Field>
            <Field label="الحالة" htmlFor="wallet-status">
              <Select id="wallet-status" value={entry.status} onChange={(event) => update('status', event.target.value)}>
                {Object.entries(MESSAGE_SOURCE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
            <Field label="وضع القراءة" htmlFor="wallet-source">
              <Select id="wallet-source" value={entry.sourceMode || 'sms'} onChange={(event) => update('sourceMode', event.target.value)}>
                {Object.entries(MESSAGE_SOURCE_MODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
            <Field label="معرّف المرسل (senderId)" htmlFor="wallet-sender">
              <Input id="wallet-sender" value={entry.senderId || ''} onChange={(event) => update('senderId', event.target.value)} maxLength={120} />
            </Field>
            {entry.sourceMode === 'notification' && (
              <Field label="اسم حزمة Android (packageName)" htmlFor="wallet-package" required>
                <Input id="wallet-package" value={entry.packageName || ''} onChange={(event) => update('packageName', event.target.value)} required maxLength={200} placeholder="com.example.wallet" dir="ltr" />
              </Field>
            )}
            {error && <p className="text-sm font-semibold text-red-700 sm:col-span-2" role="alert">{error}</p>}
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <Button type="submit" icon={Check}>حفظ في المسودة</Button>
              <Button variant="secondary" icon={X} onClick={() => { setEntry(null); setError(''); }}>إلغاء</Button>
            </div>
          </form>
        )}

        {sources.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="لا توجد مصادر رسائل في المسودة"
            description="أضف مصدرًا، أو استورد الكتالوج الافتراضي المضمّن في Android. القائمة الفارغة هنا لا يعني عدم وجود مصادر على الأجهزة."
          />
        ) : (
          <ul className="mt-4 divide-y divide-stone-100">
            {sources.map((source) => {
              const origin = describeEntrySource(source, { bundledIds, releaseIds });
              return (
                <li key={source.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-stone-900" dir="auto">{source.name || source.id}</p>
                      <Badge tone="neutral">{MESSAGE_SOURCE_MODE_LABELS[source.sourceMode] || 'SMS'}</Badge>
                      <Badge tone={source.status === 'active' ? 'success' : 'warning'}>{MESSAGE_SOURCE_STATUS_LABELS[source.status] || source.status}</Badge>
                      <Badge tone={origin.kind === 'bundled' ? 'info' : origin.kind === 'release' ? 'brand' : 'neutral'}>{origin.label}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-stone-500" dir="ltr">
                      {source.id}{source.senderId ? ` · ${source.senderId}` : ''}{source.packageName ? ` · ${source.packageName}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => { setEntry({ ...source }); setError(''); }}>تعديل</Button>
                    <Button size="sm" variant="danger" icon={Trash2} aria-label={`حذف ${source.name || source.id}`} disabled={working} onClick={() => remove(source)}>حذف</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </Section>
  );
}

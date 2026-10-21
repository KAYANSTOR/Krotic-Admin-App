import { useMemo, useState } from 'react';
import { Check, Plus, Trash2, Wallet as WalletIcon, X } from 'lucide-react';
import Section from '../../components/ui/Section';
import { Card } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import { Field, Input, Select } from '../../components/ui/Field';
import DraftScopePanel from './DraftScopePanel';
import { useTemplateCenter } from './TemplateCenterContext';
import { BUNDLED_TEMPLATE_PACK } from '../../lib/bundledTemplatePack';
import { collectReleaseEntryIds, describeEntrySource } from '../../lib/templateCenterView';

const SOURCE_MODE_LABELS = { sms: 'SMS', notification: 'إشعار تطبيق' };
const STATUS_LABELS = { active: 'نشطة', suspended: 'موقوفة مؤقتًا', archived: 'مؤرشفة' };

function makeId() {
  return `wallet-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyWallet() {
  return { id: makeId(), name: '', status: 'active', sourceMode: 'sms', senderId: '', packageName: '', createdAt: new Date().toISOString() };
}

/**
 * تبويب المحافظ ومصادر الرسائل. يعرض ويحرّر تعريف المصدر فقط
 * (الاسم، senderId، mode، packageName، الحالة) — بلا أي حقل رصيد أو مالي.
 */
export default function WalletsTab() {
  const { payload, setSection, releases, working } = useTemplateCenter();
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState('');

  const wallets = payload.wallets || [];
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
    const index = wallets.findIndex((wallet) => wallet.id === next.id);
    const updated = index < 0 ? [...wallets, next] : wallets.map((wallet, i) => (i === index ? next : wallet));
    setSection('wallets', updated);
    setEntry(null);
    setError('');
  };

  const remove = (wallet) => {
    if (!window.confirm(`حذف المحفظة "${wallet.name || wallet.id}" من المسودة؟`)) return;
    setSection('wallets', wallets.filter((item) => item.id !== wallet.id));
    if (entry?.id === wallet.id) setEntry(null);
  };

  return (
    <Section
      title="المحافظ ومصادر الرسائل"
      description="تعريف مصدر الرسائل فقط (SMS أو إشعار تطبيق) الذي يستهلكه Android لتحليل الرسائل. لا يوجد رصيد ولا حقل مالي هنا."
    >
      <DraftScopePanel />

      <div className="mt-4 rounded-xl border border-stone-200 bg-white p-4 shadow-xs">
        <p className="font-bold text-stone-900 flex items-center gap-2 text-sm mb-2">
          <WalletIcon className="h-4 w-4 text-brand-600" aria-hidden="true" />
          <span>دليل الاستخدام: ماذا سوف يحدث في شاشة المحافظ ومصادر الرسائل؟</span>
        </p>
        <div className="grid gap-3 sm:grid-cols-3 text-xs leading-5 text-stone-600">
          <div className="rounded-lg bg-stone-50 p-3 border border-stone-200/60">
            <strong className="text-stone-900 block font-bold mb-1">١. تحديد هوية المصدر فقط</strong>
            هنا نعرّف أسماء مرسلي الرسائل (senderId) أو حزم التطبيقات (packageName) التي يستهلكها هاتف نقطة البيع لربط الرسالة بالقالب المناسب.
          </div>
          <div className="rounded-lg bg-stone-50 p-3 border border-stone-200/60">
            <strong className="text-stone-900 block font-bold mb-1">٢. الحفظ في المسودة</strong>
            إضافة محفظة أو تعديل حالتها يُسجَّل في مسودة العمل الحالية فقط؛ ولا ينتقل إلى الأجهزة إلا بعد نشر الإصدار واستلام تأكيد موثوق.
          </div>
          <div className="rounded-lg bg-stone-50 p-3 border border-stone-200/60">
            <strong className="text-stone-900 block font-bold mb-1">٣. خلو القائمة هنا</strong>
            كون القائمة فارغة في هذه الشاشة يشير إلى المسودة الحالية فقط، ولا يعني عدم وجود مصادر معرّفة على الأجهزة أو في الإصدارات الأخرى.
          </div>
        </div>
      </div>

      <Card className="mt-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold">المحافظ في المسودة ({wallets.length})</h2>
          <Button icon={Plus} disabled={Boolean(entry)} onClick={() => { setEntry(emptyWallet()); setError(''); }}>إضافة محفظة</Button>
        </div>

        {entry && (
          <form onSubmit={save} className="mb-5 mt-4 grid gap-4 rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:grid-cols-2">
            <Field label="معرّف المحفظة" htmlFor="wallet-id" required hint="ثابت ولا يُعاد استخدامه. أحرف/أرقام وشرطة فقط.">
              <Input id="wallet-id" value={entry.id} onChange={(event) => update('id', event.target.value)} required maxLength={128} disabled={wallets.some((wallet) => wallet.id === entry.id)} />
            </Field>
            <Field label="الاسم" htmlFor="wallet-name" required>
              <Input id="wallet-name" value={entry.name} onChange={(event) => update('name', event.target.value)} required maxLength={120} />
            </Field>
            <Field label="الحالة" htmlFor="wallet-status">
              <Select id="wallet-status" value={entry.status} onChange={(event) => update('status', event.target.value)}>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
            <Field label="مصدر الرسائل" htmlFor="wallet-source">
              <Select id="wallet-source" value={entry.sourceMode || 'sms'} onChange={(event) => update('sourceMode', event.target.value)}>
                {Object.entries(SOURCE_MODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
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
              <Button type="submit" icon={Check}>حفظ المحفظة في المسودة</Button>
              <Button variant="secondary" icon={X} onClick={() => { setEntry(null); setError(''); }}>إلغاء</Button>
            </div>
          </form>
        )}

        {wallets.length === 0 ? (
          <EmptyState
            icon={WalletIcon}
            title="لا توجد محافظ في المسودة"
            description="أضف محافظ، أو استورد كتالوج زرع Android إلى المسودة لبدء التحرير. وجود قائمة فارغة هنا لا يعني عدم وجود محافظ على الأجهزة."
          />
        ) : (
          <ul className="mt-4 divide-y divide-stone-100">
            {wallets.map((wallet) => {
              const source = describeEntrySource(wallet, { bundledIds, releaseIds });
              return (
                <li key={wallet.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-stone-900" dir="auto">{wallet.name || wallet.id}</p>
                      <Badge tone="neutral">{SOURCE_MODE_LABELS[wallet.sourceMode] || 'SMS'}</Badge>
                      <Badge tone={wallet.status === 'active' ? 'success' : 'warning'}>{STATUS_LABELS[wallet.status] || wallet.status}</Badge>
                      <Badge tone={source.kind === 'bundled' ? 'info' : source.kind === 'release' ? 'brand' : 'neutral'}>{source.label}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-stone-500" dir="ltr">
                      {wallet.id}{wallet.senderId ? ` · ${wallet.senderId}` : ''}{wallet.packageName ? ` · ${wallet.packageName}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => { setEntry({ ...wallet }); setError(''); }}>تعديل</Button>
                    <Button size="sm" variant="danger" icon={Trash2} aria-label={`حذف ${wallet.name || wallet.id}`} disabled={working} onClick={() => remove(wallet)}>حذف</Button>
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

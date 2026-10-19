import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive, ArrowDownToLine, Beaker, Check, CircleAlert, Clock3,
  Cloud, FileText, History, Layers3, Plus, RotateCcw, Save, Send,
  ShieldCheck, Trash2, Wallet, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import PageHero from '../components/ui/PageHero';
import Section from '../components/ui/Section';
import { Card, CardHeader } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { Field, Input, Select, Textarea } from '../components/ui/Field';
import EmptyState from '../components/ui/EmptyState';
import { callAdminApi, adminApiError } from '../lib/adminApi';

const EMPTY_PAYLOAD = { wallets: [], transferTemplates: [], outboundTemplates: [] };
const TABS = [
  { id: 'wallets', label: 'المحافظ', icon: Wallet },
  { id: 'transferTemplates', label: 'قوالب التحويل الواردة', icon: ArrowDownToLine },
  { id: 'outboundTemplates', label: 'الرسائل الصادرة', icon: Send },
];
const IDENTIFIER_LABELS = {
  phone: 'رقم هاتف',
  alternativeNumber: 'رقم بديل',
  account: 'حساب',
  senderNameOnly: 'اسم المرسل',
  balanceRequestCode: 'طلب رصيد',
};
const SCOPE_LABELS = {
  outboundCustomer: 'العميل',
  outboundPos: 'نقطة البيع',
  outboundSystem: 'النظام',
};

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `template-${Date.now()}`;
}

function createEntry(tab, catalog, existing = []) {
  if (tab === 'wallets') {
    return { id: makeId(), name: '', status: 'active', sourceMode: 'sms', senderId: '', packageName: '', createdAt: new Date().toISOString() };
  }
  if (tab === 'transferTemplates') {
    return {
      id: makeId(), name: '', pattern: '', sampleBody: '', senderCode: '', walletId: '',
      posId: '', identifierKind: 'phone', priority: 100, isActive: true, requireReference: false,
    };
  }
  const usedKeys = new Set(existing.map((item) => item.key));
  const key = catalog?.outboundTemplates?.find((item) => !usedKeys.has(item.key))?.key;
  return { key: key || '', body: '' };
}

function formatDate(value) {
  const date = value?.toDate?.() || (value?.seconds ? new Date(value.seconds * 1000) : new Date(value));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' });
}

function ResultPanel({ result, type }) {
  if (!result) return null;
  const passed = type === 'simulation' ? result.matched : result.ok;
  return (
    <div className={`rounded-xl border p-4 ${passed ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : 'border-amber-200 bg-amber-50 text-amber-950'}`} role="status">
      <div className="flex items-center gap-2 font-bold">
        {passed ? <Check className="h-4 w-4" aria-hidden="true" /> : <CircleAlert className="h-4 w-4" aria-hidden="true" />}
        {type === 'simulation'
          ? (passed ? `تطابق مع ${result.templateName}` : `لم تتم المطابقة: ${result.reason || 'لا يوجد قالب مطابق'}`)
          : (passed ? 'معاينة الرسالة' : `تعذرت المعاينة: ${result.reason}`)}
      </div>
      {result.extracted && (
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {Object.entries(result.extracted).map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3 rounded-lg bg-white/70 px-3 py-2">
              <dt className="font-semibold">{key}</dt><dd dir="auto">{value == null ? '—' : String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {result.preview && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-white/70 p-3" dir="auto">{result.preview}</p>}
      {result.variables?.length > 0 && <p className="mt-2 text-sm">القيم المطلوبة: {result.variables.join('، ')}</p>}
      {type === 'simulation' && <p className="mt-2 text-xs">محاكاة فقط — لا تنفّذ إيداعًا أو معالجة مالية.</p>}
    </div>
  );
}

export default function TemplateCenterPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [releases, setReleases] = useState([]);
  const [pointers, setPointers] = useState([]);
  const [networks, setNetworks] = useState([]);
  const [catalog, setCatalog] = useState(null);
  const [activeDraftId, setActiveDraftId] = useState('');
  const [draftIsDirty, setDraftIsDirty] = useState(false);
  const [scopeType, setScopeType] = useState('global');
  const [networkId, setNetworkId] = useState('');
  const [minAppVersion, setMinAppVersion] = useState('0.0.0');
  const [minAppBuild, setMinAppBuild] = useState('0');
  const [title, setTitle] = useState('');
  const [payload, setPayload] = useState(EMPTY_PAYLOAD);
  const [tab, setTab] = useState('wallets');
  const [entry, setEntry] = useState(null);
  const [simulationBody, setSimulationBody] = useState('');
  const [simulationSender, setSimulationSender] = useState('');
  const [simulationResult, setSimulationResult] = useState(null);
  const [previewKey, setPreviewKey] = useState('');
  const [previewValues, setPreviewValues] = useState('{}');
  const [previewResult, setPreviewResult] = useState(null);

  const activeDraft = drafts.find((item) => item.id === activeDraftId) || null;
  const scope = useMemo(() => ({
    type: scopeType,
    networkId: scopeType === 'network' ? networkId : null,
  }), [scopeType, networkId]);
  const currentPointer = pointers.find((item) => item.id === (scopeType === 'global' ? 'global' : `network:${networkId}`));
  const entries = payload[tab] || [];

  const request = useCallback(async (action, rest = {}) => {
    const response = await callAdminApi('/api/template-center', { action, ...rest });
    if (!response.ok) {
      const details = Array.isArray(response.data?.details) ? response.data.details.join('، ') : '';
      throw new Error([
        adminApiError(response.error, 'تعذر الاتصال بمركز القوالب'),
        details,
      ].filter(Boolean).join(' — '));
    }
    return response.data;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [data, networkData, catalogData] = await Promise.all([
        request('list'),
        request('list-networks'),
        request('catalog'),
      ]);
      setDrafts(data.drafts || []);
      setReleases(data.releases || []);
      setPointers(data.pointers || []);
      setNetworks(networkData.networks || []);
      setCatalog(catalogData.catalog || null);
      return true;
    } catch (error) {
      console.error('Template center loading failed:', error);
      toast.error(error.message || 'تعذر تحميل مركز القوالب');
      return false;
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    setEntry(null);
    setSimulationResult(null);
    setPreviewResult(null);
  }, [tab]);

  useEffect(() => {
    setMinAppVersion(currentPointer?.minAppVersion || '0.0.0');
    setMinAppBuild(String(currentPointer?.minAppBuild ?? 0));
  }, [currentPointer?.minAppVersion, currentPointer?.minAppBuild]);

  const selectDraft = (id) => {
    setActiveDraftId(id);
    setDraftIsDirty(false);
    const selected = drafts.find((item) => item.id === id);
    if (!selected) {
      setTitle('');
      setScopeType('global');
      setNetworkId('');
      setPayload(EMPTY_PAYLOAD);
      return;
    }
    setTitle(selected.title || '');
    setScopeType(selected.scope?.type || 'global');
    setNetworkId(selected.scope?.networkId || '');
    setPayload({
      wallets: selected.payload?.wallets || [],
      transferTemplates: selected.payload?.transferTemplates || [],
      outboundTemplates: selected.payload?.outboundTemplates || [],
    });
  };

  const updateEntryField = (field, value) => {
    setDraftIsDirty(true);
    setEntry((current) => ({ ...current, [field]: value }));
  };

  const saveEntry = (event) => {
    event.preventDefault();
    if (!entry) return;
    const next = { ...entry };
    if (tab === 'wallets') {
      next.senderId = next.senderId || null;
      next.packageName = next.packageName || null;
    }
    if (tab === 'transferTemplates') {
      next.priority = Number(next.priority);
      next.walletId = next.walletId || null;
      next.posId = next.posId || null;
      next.senderCode = next.senderCode || null;
      next.sampleBody = next.sampleBody || null;
    }
    const current = payload[tab] || [];
    const index = current.findIndex((item) => (tab === 'outboundTemplates' ? item.key === next.key : item.id === next.id));
    const updated = index < 0
      ? [...current, next]
      : current.map((item, itemIndex) => itemIndex === index ? next : item);
    setPayload((previous) => ({ ...previous, [tab]: updated }));
    setDraftIsDirty(true);
    setEntry(null);
  };

  const editEntry = (item) => {
    setEntry({ ...item });
    if (tab === 'outboundTemplates') setPreviewKey(item.key);
  };

  const deleteEntry = (item) => {
    const label = tab === 'outboundTemplates' ? item.key : item.name || item.id;
    if (!window.confirm(`حذف "${label}" من المسودة؟`)) return;
    const identifier = tab === 'outboundTemplates' ? item.key : item.id;
    setPayload((previous) => ({
      ...previous,
      [tab]: previous[tab].filter((value) => (tab === 'outboundTemplates' ? value.key : value.id) !== identifier),
    }));
    setDraftIsDirty(true);
    if (entry && (tab === 'outboundTemplates' ? entry.key : entry.id) === identifier) setEntry(null);
  };

  const saveDraft = async () => {
    if (!title.trim()) {
      toast.error('أدخل عنوانًا للمسودة');
      return;
    }
    if (scopeType === 'network' && !networkId) {
      toast.error('اختر الشبكة قبل حفظ المسودة');
      return;
    }
    setSaving(true);
    try {
      const data = await request('save-draft', {
        draft: {
          id: activeDraft?.id,
          title: title.trim(),
          scope,
          payload,
          baseReleaseId: activeDraft?.baseReleaseId ?? currentPointer?.releaseId ?? null,
        },
      });
      const refreshed = await refresh();
      setActiveDraftId(data.id);
      setDraftIsDirty(false);
      if (refreshed) toast.success('تم حفظ المسودة');
      else toast.error('حُفظت المسودة، لكن تعذر تحديث القائمة. أعد تحميل الصفحة.');
    } catch (error) {
      console.error('Template draft save failed:', error);
      toast.error(error.message || 'تعذر حفظ المسودة');
    } finally {
      setSaving(false);
    }
  };

  const deleteDraft = async () => {
    if (!activeDraft || !window.confirm('حذف المسودة نهائيًا؟')) return;
    setWorking(true);
    try {
      await request('delete-draft', { draftId: activeDraft.id });
      setActiveDraftId('');
      setDraftIsDirty(false);
      setPayload(EMPTY_PAYLOAD);
      setTitle('');
      await refresh();
      toast.success('تم حذف المسودة');
    } catch (error) {
      toast.error(error.message || 'تعذر حذف المسودة');
    } finally {
      setWorking(false);
    }
  };

  const publish = async () => {
    if (!activeDraft) {
      toast.error('احفظ المسودة أولًا قبل النشر');
      return;
    }
    if (!/^\d+\.\d+\.\d+$/.test(minAppVersion)
        || !/^\d+$/.test(minAppBuild)
        || Number(minAppBuild) > 2147483647) {
      toast.error('أدخل إصدارًا بصيغة x.y.z ورقم بناء صالحًا');
      return;
    }
    if (!window.confirm('نشر هذه المسودة؟ سيصبح الإصدار نشطًا فورًا ضمن النطاق المحدد.')) return;
    setWorking(true);
    try {
      await request('publish', {
        draftId: activeDraft.id,
        expectedReleaseId: currentPointer?.releaseId ?? null,
        minAppVersion,
        minAppBuild: Number(minAppBuild),
      });
      await refresh();
      toast.success('تم نشر إصدار جديد');
    } catch (error) {
      console.error('Template release publish failed:', error);
      toast.error(error.message || 'تعذر نشر الإصدار');
    } finally {
      setWorking(false);
    }
  };

  const rollback = async (release) => {
    if (!window.confirm(`إنشاء إصدار جديد مطابق لمحتوى ${release.version}؟`)) return;
    setWorking(true);
    try {
      await request('rollback', { releaseId: release.id });
      await refresh();
      toast.success('تم إنشاء إصدار التراجع');
    } catch (error) {
      console.error('Template release rollback failed:', error);
      toast.error(error.message || 'تعذر التراجع');
    } finally {
      setWorking(false);
    }
  };

  const runSimulation = async (event) => {
    event.preventDefault();
    setWorking(true);
    try {
      const data = await request('simulate-inbound', {
        payload,
        body: simulationBody,
        sender: simulationSender,
      });
      setSimulationResult(data.result);
    } catch (error) {
      toast.error(error.message || 'تعذرت محاكاة القالب');
    } finally {
      setWorking(false);
    }
  };

  const runPreview = async (event) => {
    event.preventDefault();
    const selected = payload.outboundTemplates.find((item) => item.key === previewKey);
    if (!selected) {
      toast.error('اختر قالبًا محفوظًا في المسودة');
      return;
    }
    let values;
    try {
      values = JSON.parse(previewValues);
    } catch {
      toast.error('أدخل قيم المعاينة بصيغة JSON صحيحة');
      return;
    }
    setWorking(true);
    try {
      const data = await request('preview-outbound', { template: selected, values });
      setPreviewResult(data.result);
    } catch (error) {
      toast.error(error.message || 'تعذرت معاينة الرسالة');
    } finally {
      setWorking(false);
    }
  };

  const renderEntryForm = () => {
    if (!entry) return null;
    const update = (field) => (event) => updateEntryField(field, event.target.value);
    const checkbox = (field) => (event) => updateEntryField(field, event.target.checked);
    return (
      <form onSubmit={saveEntry} className="mb-5 grid gap-4 rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:grid-cols-2">
        {tab === 'wallets' && (
          <>
            <Field label="اسم المحفظة" htmlFor="wallet-name" required><Input id="wallet-name" value={entry.name} onChange={update('name')} required maxLength={120} /></Field>
            <Field label="الحالة" htmlFor="wallet-status"><Select id="wallet-status" value={entry.status} onChange={update('status')}><option value="active">نشطة</option><option value="suspended">موقوفة مؤقتًا</option><option value="archived">مؤرشفة</option></Select></Field>
            <Field label="مصدر الرسائل" htmlFor="wallet-source"><Select id="wallet-source" value={entry.sourceMode || 'sms'} onChange={update('sourceMode')}><option value="sms">SMS</option><option value="notification">إشعار تطبيق</option></Select></Field>
            <Field label="معرّف المرسل" htmlFor="wallet-sender"><Input id="wallet-sender" value={entry.senderId || ''} onChange={update('senderId')} maxLength={120} /></Field>
            {(entry.sourceMode === 'notification') && <Field label="اسم الحزمة" htmlFor="wallet-package" required><Input id="wallet-package" value={entry.packageName || ''} onChange={update('packageName')} required maxLength={200} /></Field>}
          </>
        )}
        {tab === 'transferTemplates' && (
          <>
            <Field label="اسم القالب" htmlFor="transfer-name" required><Input id="transfer-name" value={entry.name} onChange={update('name')} required maxLength={120} /></Field>
            <Field label="نوع المعرّف" htmlFor="transfer-kind"><Select id="transfer-kind" value={entry.identifierKind} onChange={update('identifierKind')}>{Object.entries(IDENTIFIER_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></Field>
            <Field label="نمط الرسالة" htmlFor="transfer-pattern" hint="استخدم {amount} و{phone} أو {account} و{ref} و{qty} و{dest}."><Input id="transfer-pattern" value={entry.pattern} onChange={update('pattern')} required maxLength={500} /></Field>
            <Field label="نص عينة للاختبار" htmlFor="transfer-sample"><Input id="transfer-sample" value={entry.sampleBody || ''} onChange={update('sampleBody')} maxLength={2000} /></Field>
            <Field label="المحفظة" htmlFor="transfer-wallet"><Select id="transfer-wallet" value={entry.walletId || ''} onChange={update('walletId')}><option value="">بدون تحديد</option>{payload.wallets.map((wallet) => <option value={wallet.id} key={wallet.id}>{wallet.name}</option>)}</Select></Field>
            <Field label="رمز المرسل" htmlFor="transfer-sender"><Input id="transfer-sender" value={entry.senderCode || ''} onChange={update('senderCode')} maxLength={120} /></Field>
            <Field label="معرّف نقطة البيع (اختياري)" htmlFor="transfer-pos"><Input id="transfer-pos" value={entry.posId || ''} onChange={update('posId')} maxLength={128} /></Field>
            <Field label="الأولوية" htmlFor="transfer-priority"><Input id="transfer-priority" type="number" min="0" max="9999" value={entry.priority} onChange={(event) => updateEntryField('priority', event.target.value)} /></Field>
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={Boolean(entry.isActive)} onChange={checkbox('isActive')} /> قالب نشط</label>
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={Boolean(entry.requireReference)} onChange={checkbox('requireReference')} /> يتطلب رقم مرجع</label>
          </>
        )}
        {tab === 'outboundTemplates' && (
          <>
            <Field label="نوع الرسالة" htmlFor="outbound-key">
              <Select id="outbound-key" value={entry.key} onChange={(event) => {
                updateEntryField('key', event.target.value);
                setPreviewKey(event.target.value);
              }}>
                {(catalog?.outboundTemplates || []).map((item) => <option key={item.key} value={item.key}>{item.key} — {SCOPE_LABELS[item.scope]}</option>)}
              </Select>
            </Field>
            <Field label="نص الرسالة" htmlFor="outbound-body" hint="المتغيرات المعروفة تظهر بصيغة {name} أو %name.">
              <Textarea id="outbound-body" rows={4} value={entry.body} onChange={update('body')} required maxLength={2000} className="min-h-28" />
            </Field>
          </>
        )}
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <Button type="submit" icon={Check}>حفظ العنصر</Button>
          <Button variant="secondary" onClick={() => setEntry(null)} icon={X}>إلغاء</Button>
        </div>
      </form>
    );
  };

  const renderItems = () => {
    if (entries.length === 0) {
      return <EmptyState icon={Layers3} title="لا توجد عناصر في هذا القسم" description="أضف العناصر المطلوبة إلى المسودة قبل حفظها أو نشرها." />;
    }
    return (
      <ul className="divide-y divide-stone-100">
        {entries.map((item) => {
          const key = tab === 'outboundTemplates' ? item.key : item.id;
          const name = tab === 'outboundTemplates' ? item.key : item.name || item.id;
          const description = tab === 'wallets'
            ? `${item.sourceMode === 'notification' ? 'إشعار تطبيق' : 'SMS'} · ${item.status}`
            : tab === 'transferTemplates'
              ? `${IDENTIFIER_LABELS[item.identifierKind] || item.identifierKind} · أولوية ${item.priority}${item.isActive ? ' · نشط' : ' · معطل'}`
              : item.body;
          return (
            <li key={key} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-bold text-stone-900" dir="auto">{name}</p>
                <p className="mt-1 break-words text-sm text-stone-600" dir="auto">{description}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => editEntry(item)}>تعديل</Button>
                <Button size="sm" variant="danger" icon={Trash2} aria-label={`حذف ${name}`} onClick={() => deleteEntry(item)}>حذف</Button>
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  if (loading) {
    return <div className="space-y-4 p-4" aria-busy="true"><div className="h-32 animate-pulse rounded-2xl bg-stone-200" /><div className="h-80 animate-pulse rounded-2xl bg-stone-200" /></div>;
  }

  return (
    <div className="space-y-6" dir="rtl">
      <PageHero
        icon={Layers3}
        title="مركز المحافظ والقوالب"
        subtitle="إدارة تعريفات المحافظ والقوالب الواردة والصادرة، مع مسودات وإصدارات قابلة للتدقيق."
        meta="التوزيع المركزي غير مستهلك بعد من تطبيق Android؛ لا تُغيّر هذه الصفحة بيانات التطبيق المحلية."
        actions={<Button variant="secondary" icon={Clock3} onClick={refresh} loading={loading}>تحديث</Button>}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'المسودات', value: drafts.length, icon: FileText },
          { label: 'الإصدارات المحفوظة', value: releases.length, icon: Archive },
          { label: 'النطاقات المنشورة', value: pointers.length, icon: Cloud },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-800"><Icon className="h-5 w-5" aria-hidden="true" /></span>
            <div><p className="text-sm text-stone-600">{label}</p><p className="text-xl font-extrabold tabular-nums">{value}</p></div>
          </Card>
        ))}
      </div>

      <Section title="محرر المسودة" description="التعديلات لا تصبح نشطة إلا بعد التحقق والنشر. كل نشر ينشئ إصدارًا غير قابل للتعديل.">
        <Card>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Field label="المسودة" htmlFor="draft-select">
              <Select id="draft-select" value={activeDraftId} onChange={(event) => selectDraft(event.target.value)}>
                <option value="">مسودة جديدة</option>
                {drafts.map((draft) => <option key={draft.id} value={draft.id}>{draft.title || 'مسودة بلا عنوان'} · {draft.scope?.type === 'network' ? draft.scope.networkId : 'عام'}</option>)}
              </Select>
            </Field>
            <Field label="عنوان المسودة" htmlFor="draft-title" required><Input id="draft-title" value={title} onChange={(event) => { setTitle(event.target.value); setDraftIsDirty(true); }} maxLength={120} placeholder="مثال: قوالب التحويل — أكتوبر" /></Field>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="نطاق النشر" htmlFor="draft-scope"><Select id="draft-scope" value={scopeType} onChange={(event) => { setScopeType(event.target.value); if (event.target.value === 'global') setNetworkId(''); setDraftIsDirty(true); }}><option value="global">عام لكل الشبكات</option><option value="network">شبكة محددة</option></Select></Field>
            {scopeType === 'network' && <Field label="الشبكة" htmlFor="draft-network"><Select id="draft-network" value={networkId} onChange={(event) => { setNetworkId(event.target.value); setDraftIsDirty(true); }} required><option value="">اختر شبكة</option>{networks.map((network) => <option key={network.id} value={network.id}>{network.name} · {network.id}</option>)}</Select></Field>}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="أدنى إصدار Android متوافق" htmlFor="min-app-version" hint="صيغة x.y.z. اترك 0.0.0 للسماح لكل الإصدارات.">
              <Input id="min-app-version" value={minAppVersion} onChange={(event) => setMinAppVersion(event.target.value)} pattern="^\d+\.\d+\.\d+$" maxLength={32} />
            </Field>
            <Field label="أدنى versionCode متوافق" htmlFor="min-app-build">
              <Input id="min-app-build" type="number" min="0" max="2147483647" value={minAppBuild} onChange={(event) => setMinAppBuild(event.target.value)} />
            </Field>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button icon={Save} loading={saving} onClick={saveDraft}>حفظ المسودة</Button>
            <Button variant="success" icon={Cloud} loading={working} disabled={!activeDraft || draftIsDirty || (scopeType === 'network' && !networkId)} onClick={publish}>نشر إصدار</Button>
            {activeDraft && <Button variant="danger" icon={Trash2} loading={working} onClick={deleteDraft}>حذف المسودة</Button>}
            {draftIsDirty && <Badge tone="warning">تغييرات غير محفوظة — احفظ قبل النشر</Badge>}
            {currentPointer && <Badge tone="success" dot>الإصدار النشط: {currentPointer.version || currentPointer.releaseId}</Badge>}
            {!currentPointer && <Badge tone="neutral">لا يوجد إصدار نشط لهذا النطاق</Badge>}
          </div>

          <div className="mt-6 flex flex-wrap gap-2 border-b border-stone-200 pb-3" role="tablist" aria-label="أقسام محتوى المسودة">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold transition-colors ${tab === id ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />{label}<span className="rounded-full bg-white/20 px-2 py-0.5 text-xs tabular-nums">{payload[id]?.length || 0}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-extrabold">{TABS.find((item) => item.id === tab)?.label}</h2>
            <Button icon={Plus} disabled={tab === 'outboundTemplates' && payload.outboundTemplates.length >= (catalog?.outboundTemplates?.length || 0)} onClick={() => setEntry(createEntry(tab, catalog, entries))}>إضافة عنصر</Button>
          </div>
          <div className="mt-2">{renderEntryForm()}{renderItems()}</div>
        </Card>
      </Section>

      <Section title="مختبر القوالب" description="محاكاة محلية على الخادم لأغراض التحقق فقط؛ لا ترسل رسائل ولا تنفذ عمليات مالية.">
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader title="محاكاة قالب تحويل وارد" icon={Beaker} description="يستخدم ترتيب الأولوية وتطبيع الأرقام والفواصل." />
            <form onSubmit={runSimulation} className="mt-4 space-y-4">
              <Field label="نص الرسالة التجريبي" htmlFor="simulate-body" required><Textarea id="simulate-body" rows={3} value={simulationBody} onChange={(event) => setSimulationBody(event.target.value)} maxLength={4000} required /></Field>
              <Field label="اسم أو رقم المرسل" htmlFor="simulate-sender"><Input id="simulate-sender" value={simulationSender} onChange={(event) => setSimulationSender(event.target.value)} maxLength={160} /></Field>
              <Button type="submit" icon={Beaker} loading={working}>اختبار المطابقة</Button>
              <ResultPanel result={simulationResult} type="simulation" />
            </form>
          </Card>
          <Card>
            <CardHeader title="معاينة رسالة صادرة" icon={Send} description="تتحقق من النطاق والمتغيرات دون إرسال SMS أو إشعار." />
            <form onSubmit={runPreview} className="mt-4 space-y-4">
              <Field label="القالب" htmlFor="preview-template"><Select id="preview-template" value={previewKey} onChange={(event) => setPreviewKey(event.target.value)}><option value="">اختر قالبًا</option>{payload.outboundTemplates.map((item) => <option key={item.key} value={item.key}>{item.key}</option>)}</Select></Field>
              <Field label="قيم المتغيرات (JSON)" htmlFor="preview-values" hint="مثال: {&quot;amount&quot;: &quot;1500&quot;, &quot;pos_name&quot;: &quot;شبكة تجريبية&quot;}"><Textarea id="preview-values" rows={4} value={previewValues} onChange={(event) => setPreviewValues(event.target.value)} /></Field>
              <Button type="submit" icon={Send} loading={working}>معاينة فقط</Button>
              <ResultPanel result={previewResult} type="preview" />
            </form>
          </Card>
        </div>
      </Section>

      <Section title="سجل الإصدارات" description="الإصدارات المنشورة غير قابلة للتعديل. التراجع ينشئ إصدارًا جديدًا بدل حذف التاريخ.">
        <Card>
          {releases.length === 0 ? (
            <EmptyState icon={History} title="لا توجد إصدارات منشورة" description="عند نشر أول مسودة سيظهر سجل الإصدارات هنا." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-right text-sm">
                <thead><tr className="border-b border-stone-200 text-stone-600"><th className="px-3 py-3 font-bold">الإصدار</th><th className="px-3 py-3 font-bold">النطاق</th><th className="px-3 py-3 font-bold">تاريخ النشر</th><th className="px-3 py-3 font-bold">الحالة</th><th className="px-3 py-3 font-bold">الإجراء</th></tr></thead>
                <tbody>
                  {releases.map((release) => (
                    <tr key={release.id} className="border-b border-stone-100 last:border-0">
                      <td className="px-3 py-3"><span className="font-mono" dir="ltr">{release.version || release.versionCode}</span><span className="mt-1 block text-xs text-stone-500" dir="ltr">Android ≥ {release.minAppVersion || '0.0.0'} · build {release.minAppBuild ?? 0}</span></td>
                      <td className="px-3 py-3">{release.scope?.type === 'network' ? (networks.find((item) => item.id === release.scope.networkId)?.name || release.scope.networkId) : 'عام'}</td>
                      <td className="px-3 py-3">{formatDate(release.publishedAt)}</td>
                      <td className="px-3 py-3">{pointers.some((pointer) => pointer.releaseId === release.id) ? <Badge tone="success" dot>نشط</Badge> : <Badge tone="neutral">سابق</Badge>}</td>
                      <td className="px-3 py-3"><Button size="sm" variant="secondary" icon={RotateCcw} disabled={Boolean(working)} onClick={() => rollback(release)}>استعادة المحتوى</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Section>

      <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        لا تتم مزامنة هذه الإصدارات إلى Flutter حاليًا. يلزم إصدار Android يدعم العقد المركزي قبل اعتبارها مستخدمة على الأجهزة.
      </p>
    </div>
  );
}

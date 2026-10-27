import { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles, Save, RefreshCw, ShieldAlert, User, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import PageHero from '../components/ui/PageHero';
import Section from '../components/ui/Section';
import { Card, CardHeader } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Switch from '../components/ui/Switch';
import { Field, Select } from '../components/ui/Field';
import DataFreshness from '../components/ui/DataFreshness';
import { SkeletonCard, SkeletonPageHeader } from '../components/ui/Skeleton';
import { useLocalQuery } from '../lib/localDb/useLocalQuery';
import { useLocalDb } from '../lib/localDb/LocalDbContext';
import { loadLocalUserOptions } from '../lib/localDb/localData';
import {
  fetchAccountFeatureCatalog, fetchAccountFeatures, updateAccountFeatures, adminApiError,
} from '../lib/adminApi';
import useAppRefresh from '../lib/useAppRefresh';

function FeaturesSkeleton() {
  return <div className="space-y-4"><SkeletonPageHeader /><SkeletonCard lines={4} /></div>;
}

export default function PaidFeaturesPage() {
  const { runSync, syncing } = useLocalDb();
  const usersQuery = useLocalQuery((localDb) => loadLocalUserOptions(localDb), []);
  const users = usersQuery.data || [];
  const loadingUsers = usersQuery.loading;
  const [uid, setUid] = useState('');
  const [catalog, setCatalog] = useState(null);
  const [accountFeatures, setAccountFeatures] = useState({});
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingFeatures, setLoadingFeatures] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [error, setError] = useState(null);
  const latestRequestId = useRef(0);
  const activeFeatures = (catalog?.features || []).filter((feature) => feature.status === 'active');

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    try {
      const result = await fetchAccountFeatureCatalog();
      if (!result.ok) {
        setError(adminApiError(result.error, 'تعذر تحميل كتالوج المزايا'));
        return false;
      }
      setCatalog(result.data?.catalog || null);
      return true;
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  const loadAccountFeatureMap = useCallback(async (targetUid) => {
    if (!targetUid) return;
    const requestId = ++latestRequestId.current;
    setLoadingFeatures(true);
    setError(null);
    try {
      const result = await fetchAccountFeatures(targetUid);
      if (requestId !== latestRequestId.current) return;
      if (!result.ok) {
        const message = adminApiError(result.error, 'تعذر قراءة مزايا الحساب');
        setError(message);
        setAccountFeatures({});
        return;
      }
      setAccountFeatures(result.data?.accountFeatures || {});
      setUpdatedAt(result.data?.updatedAtMs || Date.now());
    } finally {
      if (requestId === latestRequestId.current) setLoadingFeatures(false);
    }
  }, []);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  useEffect(() => {
    if (uid) loadAccountFeatureMap(uid);
    else { setAccountFeatures({}); setError(null); }
  }, [uid, loadAccountFeatureMap]);
  useEffect(() => {
    if (usersQuery.error) toast.error('تعذر تحميل قائمة الحسابات');
  }, [usersQuery.error]);

  const refresh = useCallback(async () => {
    await runSync({ reason: 'manual' });
    await Promise.all([loadCatalog(), uid ? loadAccountFeatureMap(uid) : Promise.resolve()]);
  }, [runSync, loadCatalog, loadAccountFeatureMap, uid]);
  useAppRefresh(refresh);

  const toggle = (key, value) => setAccountFeatures((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!uid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await updateAccountFeatures({ uid, features: accountFeatures });
      if (!result.ok) {
        const message = adminApiError(result.error, 'تعذر حفظ مزايا الحساب');
        setError(message);
        toast.error(message);
        return;
      }
      setAccountFeatures(result.data?.accountFeatures || accountFeatures);
      setUpdatedAt(result.data?.updatedAtMs || Date.now());
      toast.success('حُفظت مزايا الحساب على الخادم');
    } finally {
      setSaving(false);
    }
  };

  const selected = users.find((user) => user.uid === uid) || null;

  return (
    <div className="space-y-5" dir="rtl">
      <PageHero
        icon={Sparkles}
        title="مزايا الحساب"
        subtitle="خريطة مزايا الحساب لكل حساب. الكتابة تمر عبر نقطة الخادم، ولا يكتب المتصفح مباشرة على قاعدة البيانات."
        meta="الكتالوج الافتراضي مغلق؛ قيمة true الصريحة وحدها تمنح الميزة."
        actions={(
          <DataFreshness
            updatedAt={updatedAt}
            refreshing={loadingCatalog || loadingFeatures || syncing}
            onRefresh={refresh}
          />
        )}
      />

      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>تغيير هذه الخريطة يحفظ الاستحقاق على الحساب فقط؛ لا يفعّل ميزة في إصدار Android ما لم يكن ذلك الإصدار يقرأ عقد account_features.</p>
      </div>

      <Section title="اختيار الحساب" description="اختر الحساب الذي تريد عرض مزاياه وتحديثها.">
        <Card className="p-4">
          <Field label="الحساب" htmlFor="account-feature-account" hint={loadingUsers ? 'جارٍ تحميل الحسابات…' : `${users.length} حساب متاح`}>
            <Select id="account-feature-account" value={uid} disabled={loadingUsers} onChange={(event) => setUid(event.target.value)}>
              <option value="">— اختر حسابًا —</option>
              {users.map((user) => (
                <option key={user.uid} value={user.uid}>{user.name}{user.phone ? ` — ${user.phone}` : ''}</option>
              ))}
            </Select>
          </Field>
          {selected && (
            <p className="mt-3 flex items-center gap-2 text-xs text-stone-600">
              <User className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="font-mono" dir="ltr">{selected.uid}</span>
            </p>
          )}
        </Card>
      </Section>

      {uid && (
        <Section title="مزايا الحساب" description="المفاتيح غير الموجودة أو غير المفعّلة تظل مقفلة. لا تُنقل أي قيمة من الحقول القديمة.">
          {loadingCatalog || loadingFeatures ? <FeaturesSkeleton /> : (
            <Card className="p-4">
              <CardHeader
                title="الكتالوج النشط"
                icon={Sparkles}
                description="المزايا المعتمدة في كتالوج الخادم؛ كل مفتاح غير مفعّل يبقى مقفلًا."
                action={<Badge tone="neutral">نسخة الكتالوج v{catalog?.schema_version || 1}</Badge>}
              />
              {activeFeatures.length === 0 ? (
                <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">لا توجد مزايا نشطة في الكتالوج.</p>
              ) : (
                <div className="mt-4 divide-y divide-stone-100">
                  {activeFeatures.map((feature) => (
                    <div key={feature.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-stone-900">{feature.label_ar}</p>
                        {feature.description_ar && <p className="mt-0.5 text-xs leading-5 text-stone-600">{feature.description_ar}</p>}
                        <p className="mt-0.5 font-mono text-[11px] text-stone-400" dir="ltr">{feature.key}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={accountFeatures[feature.key] === true ? 'success' : 'neutral'} dot>
                          {accountFeatures[feature.key] === true ? 'مفتوحة' : 'مقفلة'}
                        </Badge>
                        <Switch
                          id={`account-feature-${feature.key}`}
                          checked={accountFeatures[feature.key] === true}
                          onChange={(value) => toggle(feature.key, value)}
                          disabled={saving}
                          label={feature.label_ar}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800" role="alert">{error}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button icon={Save} loading={saving} disabled={saving || activeFeatures.length === 0} onClick={save}>حفظ على الخادم</Button>
                <Button variant="secondary" icon={RefreshCw} disabled={loadingFeatures || saving} onClick={() => loadAccountFeatureMap(uid)}>إعادة القراءة</Button>
              </div>
              <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-stone-500">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>يحفظ الخادم رقم نسخة الخريطة ووقت آخر تحديث، ويسجّل كل تغيير في سجل تدقيق الحساب.</span>
              </p>
            </Card>
          )}
        </Section>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Sparkles, Save, RefreshCw, ShieldAlert, User, Info, ToggleRight, ToggleLeft,
} from 'lucide-react';
import toast from 'react-hot-toast';

import SearchHeader from '../components/ui/SearchHeader';
import HeroMetric from '../components/ui/HeroMetric';
import SettingsSection from '../components/ui/SettingsSection';
import SettingField from '../components/ui/SettingField';
import SaveBar from '../components/ui/SaveBar';
import { SkeletonCard } from '../components/ui/Skeleton';
import { Field, Select } from '../components/ui/Field';

import { useLocalQuery } from '../lib/localDb/useLocalQuery';
import { useLocalDb } from '../lib/localDb/LocalDbContext';
import { loadLocalUserOptions } from '../lib/localDb/localData';
import {
  fetchAccountFeatureCatalog, fetchAccountFeatures, updateAccountFeatures, adminApiError,
} from '../lib/adminApi';
import useAppRefresh from '../lib/useAppRefresh';

export default function PaidFeaturesPage() {
  const { runSync, syncing } = useLocalDb();
  const usersQuery = useLocalQuery((localDb) => loadLocalUserOptions(localDb), []);
  const users = usersQuery.data || [];
  const loadingUsers = usersQuery.loading;

  const [uid, setUid] = useState('');
  const [catalog, setCatalog] = useState(null);
  const [accountFeatures, setAccountFeatures] = useState({});
  const [originalFeatures, setOriginalFeatures] = useState({});
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingFeatures, setLoadingFeatures] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const latestRequestId = useRef(0);

  const activeFeatures = (catalog?.features || []).filter((f) => f.status === 'active');

  const dirty = useMemo(() => {
    if (!uid) return false;
    return activeFeatures.some((f) => Boolean(accountFeatures[f.key]) !== Boolean(originalFeatures[f.key]));
  }, [accountFeatures, originalFeatures, activeFeatures, uid]);

  const enabledCount = useMemo(
    () => activeFeatures.filter((f) => accountFeatures[f.key] === true).length,
    [activeFeatures, accountFeatures],
  );

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    try {
      const result = await fetchAccountFeatureCatalog();
      if (!result.ok) {
        setError(adminApiError(result.error, 'تعذر تحميل الكتالوج'));
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
        setError(adminApiError(result.error, 'تعذر قراءة المزايا'));
        setAccountFeatures({});
        setOriginalFeatures({});
        return;
      }
      const next = result.data?.accountFeatures || {};
      setAccountFeatures(next);
      setOriginalFeatures(next);
    } finally {
      if (requestId === latestRequestId.current) setLoadingFeatures(false);
    }
  }, []);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  useEffect(() => {
    if (uid) loadAccountFeatureMap(uid);
    else { setAccountFeatures({}); setOriginalFeatures({}); setError(null); }
  }, [uid, loadAccountFeatureMap]);
  useEffect(() => {
    if (usersQuery.error) toast.error('تعذر تحميل قائمة الحسابات');
  }, [usersQuery.error]);

  const refresh = useCallback(async () => {
    await runSync({ reason: 'manual' });
    await Promise.all([loadCatalog(), uid ? loadAccountFeatureMap(uid) : Promise.resolve()]);
  }, [runSync, loadCatalog, loadAccountFeatureMap, uid]);
  useAppRefresh(refresh);

  const toggle = (key, value) => {
    setAccountFeatures((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    if (!uid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await updateAccountFeatures({ uid, features: accountFeatures });
      if (!result.ok) {
        const message = adminApiError(result.error, 'تعذر حفظ المزايا');
        setError(message);
        toast.error(message);
        return;
      }
      const next = result.data?.accountFeatures || accountFeatures;
      setAccountFeatures(next);
      setOriginalFeatures(next);
      toast.success('تم حفظ المزايا');
    } finally {
      setSaving(false);
    }
  };

  const selected = users.find((u) => u.uid === uid) || null;

  if (loadingCatalog && !catalog) {
    return (
      <div className="space-y-4 pb-24">
        <div className="h-16 rounded-2xl bg-[var(--ui-sunken)]/60 animate-pulse" />
        <SkeletonCard lines={4} />
      </div>
    );
  }

  return (
    <div className="pb-32">
      <SearchHeader
        title="مزايا الحساب"
        subtitle="خريطة مزايا الحساب — الكتابة عبر الخادم"
        actions={
          <button
            type="button"
            onClick={refresh}
            disabled={syncing || loadingFeatures}
            className="p-2.5 rounded-full text-[var(--ui-muted)] hover:bg-[var(--ui-sunken)] hover:text-[var(--ui-ink)] disabled:opacity-50"
            aria-label="تحديث"
          >
            <RefreshCw className={`w-4 h-4 ${(syncing || loadingFeatures) ? 'animate-spin' : ''}`} />
          </button>
        }
      />

      <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
        <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
        <p className="leading-relaxed">
          تغيير الخريطة يحفظ الاستحقاق على الحساب فقط؛ لا يفعّل ميزة في إصدار Android
          ما لم يكن ذلك الإصدار يقرأ عقد <code className="font-mono bg-amber-100 px-1 rounded">account_features</code>.
        </p>
      </div>

      {/* اختيار الحساب */}
      <div className="mt-3 rounded-2xl bg-[var(--ui-surface)] border border-line p-4">
        <Field
          label="الحساب"
          hint={loadingUsers ? 'جارٍ التحميل…' : `${users.length} حساب متاح`}
        >
          <Select value={uid} disabled={loadingUsers} onChange={(e) => setUid(e.target.value)}>
            <option value="">— اختر حساباً —</option>
            {users.map((u) => (
              <option key={u.uid} value={u.uid}>
                {u.name}{u.phone ? ` — ${u.phone}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        {selected && (
          <p className="mt-2 flex items-center gap-2 text-[11px] text-[var(--ui-muted)]">
            <User className="w-3.5 h-3.5" />
            <span className="font-mono" dir="ltr">{selected.uid}</span>
          </p>
        )}
      </div>

      {uid && (
        <>
          <div className="mt-3">
            <HeroMetric
              label="المزايا المفعّلة"
              value={enabledCount}
              unit={`من ${activeFeatures.length}`}
              icon={Sparkles}
              trend={enabledCount > 0 ? 'up' : 'flat'}
              trendLabel={enabledCount > 0 ? `${enabledCount} مفعّلة` : 'كل المزايا مقفلة'}
              hint={catalog ? `كتالوج v${catalog.schema_version || 1}` : ''}
              tone={enabledCount > 0 ? 'brand' : 'neutral'}
            />
          </div>

          {loadingFeatures ? (
            <div className="mt-3">
              <SkeletonCard lines={3} />
            </div>
          ) : activeFeatures.length === 0 ? (
            <div className="mt-3 p-6 rounded-2xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
              لا توجد مزايا نشطة في الكتالوج.
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <SettingsSection
                title="المزايا المتاحة"
                description="المفاتيح غير الموجودة أو غير المفعّلة تظل مقفلة."
                icon={Sparkles}
              >
                {activeFeatures.map((feature) => {
                  const enabled = accountFeatures[feature.key] === true;
                  return (
                    <SettingField
                      key={feature.key}
                      label={feature.label_ar}
                      hint={feature.description_ar
                        ? `${feature.description_ar} — ${feature.key}`
                        : feature.key}
                      switch={{
                        checked: enabled,
                        onChange: (v) => toggle(feature.key, v),
                        disabled: saving,
                      }}
                    />
                  );
                })}
              </SettingsSection>

              {error && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                  <p className="flex-1">{error}</p>
                </div>
              )}

              <div className="p-3 rounded-xl bg-[var(--ui-sunken)]/60 border border-line text-[11px] text-[var(--ui-muted)] flex items-start gap-2">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <p className="leading-relaxed">
                  يحفظ الخادم رقم نسخة الخريطة ووقت آخر تحديث، ويسجّل كل تغيير في سجل التدقيق.
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {!uid && (
        <div className="mt-6 p-10 text-center rounded-2xl bg-[var(--ui-surface)] border border-line">
          <Sparkles className="w-6 h-6 mx-auto mb-2 text-[var(--ui-muted)]" />
          <p className="font-bold text-[var(--ui-ink)]">اختر حساباً للبدء</p>
          <p className="text-xs text-[var(--ui-muted)] mt-1">ستظهر المزايا المتاحة بمجرد اختيار حساب.</p>
        </div>
      )}

      {dirty && <SaveBar onSave={save} saving={saving} />}
    </div>
  );
}

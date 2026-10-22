// src/pages/PaidFeaturesPage.jsx
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
import { fetchUsersForSelect } from '../lib/adminData';
import { fetchPaidFeatureEntitlements, updatePaidFeatureEntitlements, adminApiError } from '../lib/adminApi';
import useAppRefresh from '../lib/useAppRefresh';

/**
 * المزايا المدفوعة: تُكتب من الخادم فقط على `users/{uid}.feature_entitlements`.
 * مفصولة تمامًا عن عقد lease الموقّع وعن سجل الأجهزة.
 *
 * تنبيه صادق: المستهلك المعلن في Android (PaidFeature/PaidFeatureGate) غير موجود
 * في KAYANSTOR/Krotak-Pro@main وقت التنفيذ؛ لذلك تغيير هذه الخريطة لا يُدّعى أنه
 * يؤثر في جهاز فعلي قبل إثبات وجود المستهلك واعتماد العقد من وكيل Android.
 */
const FEATURES = [
  { key: 'hotspot_template_editor', label: 'محرّر قوالب الهوتسبوت', hint: 'يفتح تحرير قوالب الهوتسبوت على التطبيق.' },
  { key: 'mikrotik_card_generator', label: 'مولّد كروت ميكروتك', hint: 'يفتح توليد كروت ميكروتك على التطبيق.' },
];

const EMPTY_MAP = { hotspot_template_editor: false, mikrotik_card_generator: false };

function PaidFeaturesSkeleton() {
  return (
    <div className="space-y-4">
      <SkeletonPageHeader />
      <SkeletonCard lines={4} />
      <SkeletonCard lines={3} />
    </div>
  );
}

export default function PaidFeaturesPage() {
  const [users, setUsers] = useState([]);
  const [uid, setUid] = useState('');
  const [entitlements, setEntitlements] = useState(EMPTY_MAP);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingEntitlements, setLoadingEntitlements] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [error, setError] = useState(null);
  const latestRequestId = useRef(0);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const list = await fetchUsersForSelect({});
      setUsers(Array.isArray(list) ? list : []);
    } catch (loadError) {
      console.error('Error fetching users for paid features:', loadError);
      toast.error('تعذر تحميل قائمة الحسابات');
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const loadEntitlements = useCallback(async (targetUid) => {
    if (!targetUid) return;
    const requestId = ++latestRequestId.current;
    setLoadingEntitlements(true);
    setError(null);
    try {
      const result = await fetchPaidFeatureEntitlements(targetUid);
      if (requestId !== latestRequestId.current) return;
      if (!result.ok) {
        setError(adminApiError(result.error, 'تعذر قراءة المزايا المدفوعة'));
        setEntitlements(EMPTY_MAP);
        return;
      }
      setEntitlements({ ...EMPTY_MAP, ...(result.data?.entitlements || {}) });
      setUpdatedAt(Date.now());
    } finally {
      if (requestId === latestRequestId.current) setLoadingEntitlements(false);
    }
  }, []);

  useEffect(() => {
    if (uid) loadEntitlements(uid);
    else { setEntitlements(EMPTY_MAP); setError(null); }
  }, [uid, loadEntitlements]);

  useAppRefresh(() => loadEntitlements(uid));

  const toggle = (key, value) => setEntitlements((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!uid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await updatePaidFeatureEntitlements({ uid, entitlements });
      if (!result.ok) {
        const message = adminApiError(result.error, 'تعذر حفظ المزايا المدفوعة');
        setError(message);
        toast.error(message);
        return;
      }
      setEntitlements({ ...EMPTY_MAP, ...(result.data?.entitlements || entitlements) });
      setUpdatedAt(Date.now());
      // الخادم يكتب سجل التدقيق (PAID_FEATURE_ENTITLEMENT_UPDATE) داخل المعاملة؛
      // لا نكرّره من العميل.
      toast.success('حُفظت المزايا المدفوعة على الخادم');
    } finally {
      setSaving(false);
    }
  };

  const selected = users.find((user) => user.uid === uid) || null;

  return (
    <div className="space-y-5" dir="rtl">
      <PageHero
        icon={Sparkles}
        title="المزايا المدفوعة"
        subtitle="تفعيل/إيقاف المزايا المدفوعة على حساب محدد. تُكتب من الخادم فقط ولا يكتبها المتصفح مباشرة على Firestore."
        meta="منفصلة عن عقد lease الموقّع وعن سجل الأجهزة. لا تمنح lease ميزة لا يمنحها هذا الحقل."
        actions={(
          <DataFreshness
            updatedAt={updatedAt}
            refreshing={loadingEntitlements}
            onRefresh={() => loadEntitlements(uid)}
          />
        )}
      />

      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          تنبيه عقد: مستهلك Android المعلن لهذه الخريطة (PaidFeature / PaidFeatureGate) غير موجود في
          مستودع Android وقت التنفيذ. حفظ الخريطة إجراء إداري حقيقي على الحساب، لكنه
          {' '}لا يُثبت{' '}
          تأثيرًا على أي جهاز فعلي قبل اعتماد العقد من وكيل Android.
        </p>
      </div>

      <Section
        title="اختيار الحساب"
        description="اختر الحساب لعرض وتعديل خريطة المزايا المدفوعة الخاصة به."
      >
        <Card className="p-4">
          <Field
            label="الحساب"
            htmlFor="paid-feature-account"
            hint={loadingUsers ? 'جارٍ تحميل الحسابات…' : `${users.length} حساب متاح`}
          >
            <Select
              id="paid-feature-account"
              value={uid}
              disabled={loadingUsers}
              onChange={(event) => setUid(event.target.value)}
            >
              <option value="">— اختر حسابًا —</option>
              {users.map((user) => (
                <option key={user.uid} value={user.uid}>
                  {user.name}{user.phone ? ` — ${user.phone}` : ''}
                </option>
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
        <Section
          title="خريطة المزايا"
          description="القيمة الوحيدة التي تفتح ميزة هي true؛ الغياب أو أي قيمة أخرى = مقفلة (fail-closed في Android)."
        >
          {loadingEntitlements ? <PaidFeaturesSkeleton /> : (
            <Card className="p-4">
              <CardHeader
                title="الميزات المتاحة"
                icon={Sparkles}
                description="المفاتيح المعتمدة فقط وفق عقد feature-entitlements."
                action={<Badge tone="neutral">schemaVersion 1</Badge>}
              />
              <div className="mt-4 divide-y divide-stone-100">
                {FEATURES.map((feature) => (
                  <div key={feature.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-stone-900">{feature.label}</p>
                      <p className="mt-0.5 text-xs leading-5 text-stone-600">{feature.hint}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-stone-400" dir="ltr">{feature.key}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={entitlements[feature.key] ? 'success' : 'neutral'} dot>
                        {entitlements[feature.key] ? 'مفتوحة' : 'مقفلة'}
                      </Badge>
                      <Switch
                        id={`feature-${feature.key}`}
                        checked={Boolean(entitlements[feature.key])}
                        onChange={(value) => toggle(feature.key, value)}
                        disabled={saving}
                        label={feature.label}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {error && (
                <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800" role="alert">{error}</p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button icon={Save} loading={saving} disabled={saving} onClick={save}>حفظ على الخادم</Button>
                <Button variant="secondary" icon={RefreshCw} disabled={loadingEntitlements || saving} onClick={() => loadEntitlements(uid)}>إعادة القراءة</Button>
              </div>

              <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-stone-500">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                الحفظ يمرّ عبر <span className="font-mono" dir="ltr">POST /api/paid-features</span> بعد تحقق خادمي من صلاحية المدير، ويُسجَّل في سجل العمليات.
              </p>
            </Card>
          )}
        </Section>
      )}
    </div>
  );
}

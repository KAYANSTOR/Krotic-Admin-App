import { NavLink, Outlet } from 'react-router-dom';
import {
  Archive, ArrowDownToLine, Cloud, Layers3, ListChecks, Send, Wallet, ShieldAlert,
} from 'lucide-react';
import PageHero from '../../components/ui/PageHero';
import Section from '../../components/ui/Section';
import { Card } from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { useTemplateCenter } from './TemplateCenterContext';
import {
  APPLICATION_STATE_LABELS, deriveApplicationState, describeScope, formatTimestamp,
} from '../../lib/templateCenterView';

const TABS = [
  { path: '/template-center/wallets', label: 'المحافظ ومصادر الرسائل', icon: Wallet },
  { path: '/template-center/inbound', label: 'قوالب التحويل الواردة', icon: ArrowDownToLine },
  { path: '/template-center/outbound', label: 'الرسائل الصادرة (SMS)', icon: Send },
  { path: '/template-center/releases', label: 'الإصدارات والمؤشرات', icon: Archive },
  { path: '/template-center/reconciliation', label: 'التسوية والعناصر القديمة', icon: ListChecks },
];

function toneForState(tone) {
  return tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : tone === 'danger' ? 'danger' : 'neutral';
}

export default function TemplateCenterLayout() {
  const { loading, drafts, releases, pointers, networks, currentPointer, currentAck, scope, refresh } = useTemplateCenter();

  const applicationState = deriveApplicationState({ pointer: currentPointer, ack: currentAck });

  if (loading) {
    return (
      <div className="space-y-4 p-4" aria-busy="true">
        <div className="h-32 animate-pulse rounded-2xl bg-stone-200" />
        <div className="h-80 animate-pulse rounded-2xl bg-stone-200" />
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <PageHero
        icon={Layers3}
        title="مركز المحافظ والقوالب"
        subtitle="مساحات منفصلة للمحافظ ومصادر الرسائل، وقوالب التحويل الواردة، والرسائل الصادرة SMS، مع سجل الإصدارات المركزي."
        meta="النشر مركزي فقط. لا تُطبَّق أي بيانات على أجهزة Android قبل وصول ACK موثوق؛ الحالة الافتراضية «غير معروف»."
        actions={<Button variant="secondary" icon={Cloud} onClick={refresh} loading={loading}>تحديث</Button>}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'المسودات', value: drafts.length, icon: Layers3 },
          { label: 'الإصدارات المنشورة', value: releases.length, icon: Archive },
          { label: 'النطاقات المنشورة', value: pointers.length, icon: Cloud },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-800">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm text-stone-600">{label}</p>
              <p className="text-xl font-extrabold tabular-nums">{value}</p>
            </div>
          </Card>
        ))}
      </div>

      <Section
        title="حالة النطاق الحالي"
        description="النطاق المحدد في محرر المسودة. النشر المركزي لا يعني تطبيقًا على الأجهزة."
      >
        <Card className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{describeScope(scope, networks)}</Badge>
            {currentPointer
              ? <Badge tone="success" dot>إصدار نشط: {currentPointer.version || currentPointer.releaseId}</Badge>
              : <Badge tone="neutral">لا يوجد إصدار نشط لهذا النطاق</Badge>}
            <Badge tone={toneForState(applicationState.tone)}>
              حالة الأجهزة: {APPLICATION_STATE_LABELS[applicationState.state] || applicationState.state}
            </Badge>
          </div>
          <p className="text-sm leading-6 text-stone-700">{applicationState.detail}</p>
          {currentPointer && (
            <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-lg bg-stone-50 px-3 py-2">
                <dt className="font-semibold text-stone-600">معرّف الإصدار</dt>
                <dd className="font-mono text-xs" dir="ltr">{currentPointer.releaseId}</dd>
              </div>
              <div className="rounded-lg bg-stone-50 px-3 py-2">
                <dt className="font-semibold text-stone-600">versionCode</dt>
                <dd className="tabular-nums">{currentPointer.versionCode ?? '—'}</dd>
              </div>
              <div className="rounded-lg bg-stone-50 px-3 py-2">
                <dt className="font-semibold text-stone-600">أدنى توافق</dt>
                <dd dir="ltr">Android ≥ {currentPointer.minAppVersion || '0.0.0'} · build {currentPointer.minAppBuild ?? 0}</dd>
              </div>
              <div className="rounded-lg bg-stone-50 px-3 py-2">
                <dt className="font-semibold text-stone-600">آخر تحديث للمؤشر</dt>
                <dd>{formatTimestamp(currentPointer.updatedAt)}</dd>
              </div>
              <div className="rounded-lg bg-stone-50 px-3 py-2">
                <dt className="font-semibold text-stone-600">المُحدِّث</dt>
                <dd className="font-mono text-xs" dir="ltr">{currentPointer.updatedBy || '—'}</dd>
              </div>
            </dl>
          )}
          {currentAck ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-lg bg-emerald-50 px-3 py-2">
                <dt className="font-semibold text-stone-600">آخر تأكيد موثوق</dt>
                <dd>{formatTimestamp(currentAck.appliedAt)}</dd>
              </div>
              <div className="rounded-lg bg-emerald-50 px-3 py-2">
                <dt className="font-semibold text-stone-600">الجهاز (installationId)</dt>
                <dd className="font-mono text-xs" dir="ltr">{currentAck.installationId}</dd>
              </div>
              <div className="rounded-lg bg-emerald-50 px-3 py-2">
                <dt className="font-semibold text-stone-600">النتيجة</dt>
                <dd>{currentAck.outcome === 'partially_applied' ? 'مطبَّق جزئيًا' : 'مطبَّق بالكامل'}{currentAck.parserRefreshed ? ' + أُعيد بناء المحلل' : ''}</dd>
              </div>
              <div className="rounded-lg bg-emerald-50 px-3 py-2">
                <dt className="font-semibold text-stone-600">العناصر المُدرجة</dt>
                <dd className="tabular-nums">{currentAck.insertedCount ?? 0}</dd>
              </div>
              <div className="rounded-lg bg-emerald-50 px-3 py-2">
                <dt className="font-semibold text-stone-600">التعارضات المتروكة</dt>
                <dd className="tabular-nums">{currentAck.conflictCount ?? 0}</dd>
              </div>
              <div className="rounded-lg bg-emerald-50 px-3 py-2">
                <dt className="font-semibold text-stone-600">البصمة المطابقة</dt>
                <dd className="font-mono text-xs" dir="ltr">{currentAck.payloadHash ? `${currentAck.payloadHash.slice(0, 12)}…` : '—'}</dd>
              </div>
            </dl>
          ) : (
            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              لا يوجد ACK موثوق مطابق لهذا الإصدار بعد. تظهر الأجهزة كـ«غير معروف» حتى يُعتمد عقد ACK ويُرسله تطبيق Android.
            </p>
          )}
        </Card>
      </Section>

      <nav className="flex flex-wrap gap-2 border-b border-stone-200 pb-3" aria-label="أقسام مركز القوالب">
        {TABS.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) => `inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold transition-colors ${isActive ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'}`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />{label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}

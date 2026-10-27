import { useMemo } from 'react';
import { Archive, CheckCircle2, CircleDashed, History, Package, RotateCcw, Send, Smartphone } from 'lucide-react';
import Section from '../../components/ui/Section';
import { Card } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import { useTemplateCenter } from './TemplateCenterContext';
import {
  ACK_HEALTH_LABELS, APPLICATION_STATE_LABELS, classifyAckHealth, countAcknowledgingDevices,
  deriveApplicationState, describeScope, formatTimestamp, labelAckOutcome, scopeKeyFor,
} from '../../lib/templateCenterView';
import { BUNDLED_TEMPLATE_PACK } from '../../lib/bundledTemplatePack';

function StatusCard({ icon: Icon, title, badge = null, children }) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-stone-100 text-stone-700">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <p className="font-bold text-stone-900">{title}</p>
      </div>
      <div className="text-sm leading-6 text-stone-700">{children}</div>
      {badge}
    </Card>
  );
}

/**
 * تبويب الإصدارات والنشر: يفرّق بوضوح بين الكتالوج الافتراضي المضمّن في Android،
 * والمسودة، والإصدار المنشور، وحالة تطبيق الأجهزة (Unknown افتراضيًا).
 */
export default function ReleasesTab() {
  const { releases, pointers, networks, drafts, acks, currentPointer, currentAck, working, rollback } = useTemplateCenter();

  const bundledCounts = useMemo(() => ({
    wallets: BUNDLED_TEMPLATE_PACK.wallets.length,
    transferTemplates: BUNDLED_TEMPLATE_PACK.transferTemplates.length,
    outboundTemplates: BUNDLED_TEMPLATE_PACK.outboundTemplates.length,
  }), []);

  const activeScopeKey = scopeKeyFor(currentPointer?.scope || { type: 'global' });
  const deviceState = deriveApplicationState({ pointer: currentPointer, ack: currentAck });
  const acknowledgingDevices = countAcknowledgingDevices(acks, {
    releaseId: currentPointer?.releaseId ?? null,
    scopeKey: activeScopeKey,
  });
  const ackHealthRows = acks.map((ack) => {
    const pointer = pointers.find((item) => item.id === (ack.scopeKey || 'global')) || null;
    const state = classifyAckHealth(ack, { pointer, releases });
    const tone = state === 'matched' ? 'success' : state === 'failed' ? 'danger'
      : state === 'conflict' ? 'warning' : 'neutral';
    return { ack, state, tone };
  });

  const ackSummary = (release) => {
    const scope = release.scopeKey || 'global';
    const pointer = pointers.find((item) => item.id === scope) || null;
    const scopeAcks = acks.filter((ack) => ack.verified === true && (ack.scopeKey || 'global') === scope);
    if (!scopeAcks.length) return { tone: 'warning', label: 'لا يوجد ACK' };
    if (!pointer) return { tone: 'warning', label: `${scopeAcks.length} ACK بلا مؤشر نشط` };
    if (pointer.releaseId !== release.id) return { tone: 'neutral', label: `${scopeAcks.length} ACK لإصدار أحدث` };
    const counts = { matched: 0, conflict: 0, stale: 0, failed: 0, unknown: 0 };
    scopeAcks.forEach((ack) => {
      const state = classifyAckHealth(ack, { pointer, releases });
      counts[state] = (counts[state] || 0) + 1;
    });
    if (counts.conflict) return { tone: 'warning', label: `${counts.matched} مطابق · ${counts.conflict} تعارض` };
    if (counts.failed) return { tone: 'danger', label: `${counts.failed} فشل` };
    if (counts.matched) return { tone: 'success', label: `${counts.matched} مطابق` };
    return { tone: 'neutral', label: ACK_HEALTH_LABELS[Object.keys(counts).find((key) => counts[key]) || 'unknown'] };
  };

  return (
    <Section
      title="الإصدارات والنشر"
      description="الإصدارات المنشورة غير قابلة للتعديل. التراجع ينشئ إصدارًا جديدًا بدل حذف التاريخ."
    >
      <div className="grid gap-3 lg:grid-cols-4">
        <StatusCard icon={Package} title="الكتالوج الافتراضي المضمّن في Android">
          <p>عناصر يطابقها التطبيق افتراضيًا وبنفس المعرّفات: {bundledCounts.wallets} مصدر رسائل، {bundledCounts.transferTemplates} قالب وارد، {bundledCounts.outboundTemplates} رسالة صادرة.</p>
          <p className="mt-2 text-xs text-stone-500">ليست بيانات إنتاج، ولا مسودة محفوظة، ولا تعني أي شيء عن الأجهزة.</p>
        </StatusCard>
        <StatusCard icon={Archive} title="المسودة المحفوظة">
          {drafts.length === 0
            ? <p>لا توجد مسودات محفوظة مركزيًا.</p>
            : <p>{drafts.length} مسودة محفوظة. حفظ المسودة لا يغيّر المؤشر النشط.</p>}
        </StatusCard>
        <StatusCard
          icon={CheckCircle2}
          title="الإصدار المنشور"
          badge={pointers.length ? <Badge tone="success" dot>{APPLICATION_STATE_LABELS.PublishedCentrally}</Badge> : null}
        >
          {pointers.length === 0
            ? <p>لا توجد إصدارات منشورة.</p>
            : <p>{releases.length} إصدار منشور، و{pointers.length} نطاق له مؤشر نشط.</p>}
        </StatusCard>
        <StatusCard
          icon={Smartphone}
          title="حالة تطبيق الأجهزة"
          badge={<Badge tone={deviceState.tone}>{APPLICATION_STATE_LABELS[deviceState.state]}</Badge>}
        >
          <p>{deviceState.detail}</p>
          {currentAck
            ? <p className="mt-2 text-xs text-stone-500">{acknowledgingDevices} جهاز أكّد هذا الإصدار.</p>
            : <p className="mt-2 text-xs text-stone-500">لا ACK موثوق بعد — الحالة «غير معروف» حتى يرسل تطبيق Android تأكيدًا.</p>}
        </StatusCard>
      </div>

      <Section title="المؤشرات النشطة" description="مؤشر واحد لكل نطاق (عام/شبكة) يشير إلى الإصدار النشط." className="mt-6">
        <Card className="p-4">
          {pointers.length === 0 ? (
            <EmptyState icon={CircleDashed} title="لا توجد مؤشرات نشطة" description="عند نشر أول مسودة سيظهر مؤشر النطاق هنا." />
          ) : (
            <ul className="divide-y divide-stone-100">
              {pointers.map((pointer) => (
                <li key={pointer.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-bold text-stone-900">{describeScope({ type: pointer.id === 'global' ? 'global' : 'network', networkId: pointer.id.replace('network:', '') }, networks)}</p>
                    <p className="text-xs text-stone-500" dir="ltr">{pointer.releaseId}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="success" dot>نشط</Badge>
                    <Badge tone="neutral">versionCode {pointer.versionCode ?? '—'}</Badge>
                    <Badge tone="neutral">Android ≥ {pointer.minAppVersion || '0.0.0'} · build {pointer.minAppBuild ?? 0}</Badge>
                    {(() => {
                      const summary = ackSummary({ id: pointer.releaseId, scopeKey: pointer.id });
                      return <Badge tone={summary.tone}>الأجهزة: {summary.label}</Badge>;
                    })()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      <Section title="آخر تأكيد لكل جهاز" description="تُقرأ وثيقة واحدة فقط لكل users/{uid}/template_acks/{deviceId}. الحالات مشتقة لحظياً مقارنة بالمؤشر النشط وبصمة الإصدار." className="mt-6">
        <Card className="p-4">
          {ackHealthRows.length === 0 ? (
            <EmptyState icon={Smartphone} title="لا توجد تأكيدات أجهزة" description="ستظهر آخر استجابة من كل جهاز بعد استلام ACK موثّق من تطبيق Android." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-right text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-600">
                    <th className="px-3 py-3 font-bold">الحساب / الشبكة</th>
                    <th className="px-3 py-3 font-bold">الجهاز</th>
                    <th className="px-3 py-3 font-bold">آخر إصدار</th>
                    <th className="px-3 py-3 font-bold">نتيجة التطبيق</th>
                    <th className="px-3 py-3 font-bold">الحالة المحسوبة</th>
                    <th className="px-3 py-3 font-bold">وقت الاستلام</th>
                  </tr>
                </thead>
                <tbody>
                  {ackHealthRows.map(({ ack, state, tone }) => (
                    <tr key={`${ack.uid || 'unknown'}-${ack.installationId}`} className="border-b border-stone-100 last:border-0">
                      <td className="px-3 py-3">
                        <span>{ack.networkId ? describeScope({ type: 'network', networkId: ack.networkId }, networks) : (ack.uid || '—')}</span>
                        <span className="mt-1 block font-mono text-[11px] text-stone-500" dir="ltr">{ack.uid || '—'}</span>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs" dir="ltr">{ack.installationId}</td>
                      <td className="px-3 py-3">
                        <span className="font-mono" dir="ltr">{ack.version || ack.releaseId || '—'}</span>
                        <span className="mt-1 block font-mono text-[11px] text-stone-500" dir="ltr">{ack.releaseId || '—'}</span>
                      </td>
                      <td className="px-3 py-3">{labelAckOutcome(ack.outcome)} · {ack.insertedCount} أضيف · {ack.conflictCount} تعارض</td>
                      <td className="px-3 py-3"><Badge tone={tone}>{ACK_HEALTH_LABELS[state]}</Badge></td>
                      <td className="px-3 py-3">{formatTimestamp(ack.appliedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Section>

      <Section title="سجل الإصدارات" description="كل نشر ينشئ إصدارًا ثابتًا ببصمة hash ووقت وناشر. التراجع ينشئ إصدارًا جديدًا." className="mt-6">
        <Card className="p-4">
          {releases.length === 0 ? (
            <EmptyState icon={History} title="لا توجد إصدارات منشورة" description="عند نشر أول مسودة سيظهر سجل الإصدارات هنا." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-right text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-600">
                    <th className="px-3 py-3 font-bold">الإصدار</th>
                    <th className="px-3 py-3 font-bold">النطاق</th>
                    <th className="px-3 py-3 font-bold">بصمة الحمولة (hash)</th>
                    <th className="px-3 py-3 font-bold">تاريخ النشر</th>
                    <th className="px-3 py-3 font-bold">الناشر</th>
                    <th className="px-3 py-3 font-bold">الحالة</th>
                    <th className="px-3 py-3 font-bold">الأجهزة</th>
                    <th className="px-3 py-3 font-bold">الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {releases.map((release) => {
                    const isActive = pointers.some((pointer) => pointer.releaseId === release.id);
                    return (
                      <tr key={release.id} className="border-b border-stone-100 last:border-0">
                        <td className="px-3 py-3">
                          <span className="font-mono" dir="ltr">{release.version || release.versionCode}</span>
                          <span className="mt-1 block text-xs text-stone-500" dir="ltr">Android ≥ {release.minAppVersion || '0.0.0'} · build {release.minAppBuild ?? 0}</span>
                          {release.rollbackOf && <span className="mt-1 block text-xs text-amber-700">تراجع عن {release.rollbackOf}</span>}
                        </td>
                        <td className="px-3 py-3">{describeScope(release.scope, networks)}</td>
                        <td className="px-3 py-3"><span className="font-mono text-xs" dir="ltr" title={release.payloadHashSha256}>{release.payloadHashSha256 ? `${release.payloadHashSha256.slice(0, 12)}…` : '—'}</span></td>
                        <td className="px-3 py-3">{formatTimestamp(release.publishedAt)}</td>
                        <td className="px-3 py-3"><span className="font-mono text-xs" dir="ltr">{release.publishedBy || release.createdBy || '—'}</span></td>
                        <td className="px-3 py-3">{isActive ? <Badge tone="success" dot>نشط</Badge> : <Badge tone="neutral">سابق</Badge>}</td>
                        <td className="px-3 py-3"><Badge tone={ackSummary(release).tone}>{ackSummary(release).label}</Badge></td>
                        <td className="px-3 py-3">
                          <Button size="sm" variant="secondary" icon={RotateCcw} disabled={Boolean(working)} onClick={() => rollback(release)}>تراجع</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Section>

      <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        <Send className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        النشر مركزي فقط؛ لا تُعدّ الحالة مطبَّقة على أي جهاز قبل وصول ACK موثوق مطابق للإصدار والبصمة.
      </p>
    </Section>
  );
}

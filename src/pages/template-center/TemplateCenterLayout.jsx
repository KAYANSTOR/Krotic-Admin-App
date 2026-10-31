import { NavLink, Outlet } from 'react-router-dom';
import {
  Archive, ArrowDownToLine, Layers3, ListChecks, MessageSquare, Send, RefreshCw,
} from 'lucide-react';
import { useTemplateCenter } from './TemplateCenterContext';
import { TEMPLATE_CENTER_NAV, TEMPLATE_CENTER_ROOT } from '../../lib/templateCenterRoutes';
import SearchHeader from '../../components/ui/SearchHeader';
import HeroMetric from '../../components/ui/HeroMetric';
import {
  APPLICATION_STATE_LABELS, deriveApplicationState, describeScope,
} from '../../lib/templateCenterView';

const TAB_ICONS = {
  '/template-center/wallets': MessageSquare,
  '/template-center/inbound': ArrowDownToLine,
  '/template-center/outbound': Send,
  '/template-center/releases': Archive,
  '/template-center/reconciliation': ListChecks,
};

const TABS = TEMPLATE_CENTER_NAV.map((item) => ({ ...item, icon: TAB_ICONS[item.path] || Layers3 }));

export default function TemplateCenterLayout() {
  const { loading, drafts, releases, pointers, networks, currentPointer, currentAck, scope, refresh } = useTemplateCenter();
  const applicationState = deriveApplicationState({ pointer: currentPointer, ack: currentAck });

  if (loading) {
    return (
      <div className="space-y-4 p-4" aria-busy="true">
        <div className="h-16 rounded-2xl bg-[var(--ui-sunken)]/60 animate-pulse" />
        <div className="h-32 rounded-3xl bg-[var(--ui-sunken)]/60 animate-pulse" />
        <div className="h-16 rounded-2xl bg-[var(--ui-sunken)]/60 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="pb-24" dir="rtl">
      <SearchHeader
        title={TEMPLATE_CENTER_ROOT.label}
        subtitle={describeScope(scope, networks)}
        actions={
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="p-2.5 rounded-full text-[var(--ui-muted)] hover:bg-[var(--ui-sunken)] hover:text-[var(--ui-ink)] disabled:opacity-50"
            aria-label="تحديث"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        }
      />

      <div className="mt-3">
        <HeroMetric
          label="حالة النطاق"
          value={APPLICATION_STATE_LABELS[applicationState.state] || applicationState.state}
          unit={currentPointer?.version || currentPointer?.releaseId ? `v${currentPointer.version || currentPointer.releaseId.slice(0, 8)}` : ''}
          icon={Layers3}
          tone={applicationState.tone === 'success' ? 'success' : applicationState.tone === 'danger' ? 'danger' : 'brand'}
          trend="flat"
          hint={applicationState.detail}
        />
      </div>

      {/* شارة الإحصاءات */}
      <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        <span className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand/10 text-brand-deep text-xs font-bold border border-brand/20">
          <Layers3 className="w-3.5 h-3.5" />
          {drafts.length} مسودة
        </span>
        <span className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-800 text-xs font-bold border border-emerald-200">
          <Archive className="w-3.5 h-3.5" />
          {releases.length} إصدار
        </span>
        <span className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--ui-sunken)] text-[var(--ui-ink-soft)] text-xs font-bold border border-line">
          <RefreshCw className="w-3.5 h-3.5" />
          {pointers.length} نطاق
        </span>
      </div>

      {/* التبويبات */}
      <nav className="mt-3 android-tabs" role="group" aria-label="أقسام مركز القوالب">
        {TABS.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) => `android-tab min-h-[44px] ${isActive ? 'is-active' : ''}`}
          >
            <Icon className="w-4 h-4 ml-1" />
            <span className="text-[11px] sm:text-xs font-bold truncate">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="mt-3">
        <Outlet />
      </div>
    </div>
  );
}

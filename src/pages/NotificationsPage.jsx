import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Bell, Send, History, FileText, AlertCircle, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

import PageHero from '../components/ui/PageHero';
import Button from '../components/ui/Button';
import DataFreshness from '../components/ui/DataFreshness';
import { SkeletonCard, SkeletonPageHeader } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ConfirmDialog';
import PhoneNotificationModal from '../components/PhoneNotificationModal';
import ComposeTab from '../components/notifications/ComposeTab';
import HistoryTab from '../components/notifications/HistoryTab';
import TemplatesTab from '../components/notifications/TemplatesTab';

import useAppRefresh from '../lib/useAppRefresh';
import { loadTemplates, saveTemplate, deleteTemplate } from '../lib/notificationTemplates';
import { triggerScheduledDispatch } from '../lib/adminApi';
import { useNotifications } from '../hooks/notifications/useNotifications';
import {
  TABS,
  TEMPLATE_STORAGE_PREFIX,
  loadSavedTab,
  saveSavedTab,
} from '../lib/notifications/constants';

export default function NotificationsPage() {
  const {
    users,
    recentNotifications,
    loading,
    loadError,
    syncing,
    lastSyncAt,
    sending,
    deleting,
    refresh,
    sendOrSchedule,
    deleteNotificationFromHistory,
  } = useNotifications();

  const [activeTab, setActiveTab] = useState(loadSavedTab);
  const [templates, setTemplates] = useState(() => loadTemplates());
  const [pendingTemplateId, setPendingTemplateId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [phoneModalOpen, setPhoneModalOpen] = useState(false);
  const dispatchRanRef = useRef(false);

  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  const stableRefresh = useCallback(() => refreshRef.current(), []);
  useAppRefresh(stableRefresh);

  // This dispatcher only processes due scheduled requests; prevent duplicate calls in StrictMode.
  useEffect(() => {
    if (dispatchRanRef.current) return;
    dispatchRanRef.current = true;
    Promise.resolve()
      .then(() => triggerScheduledDispatch())
      .catch((error) => console.warn('Scheduled notification dispatch failed:', error));
  }, []);

  useEffect(() => { saveSavedTab(activeTab); }, [activeTab]);

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === null || event.key?.startsWith(TEMPLATE_STORAGE_PREFIX)) {
        setTemplates(loadTemplates());
      }
      if (event.key === 'krotak:notif-active-tab' && event.newValue
        && Object.values(TABS).includes(event.newValue)) {
        setActiveTab(event.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const handleSend = useCallback(async (draft) => {
    const succeeded = await sendOrSchedule(draft);
    if (succeeded) setActiveTab(TABS.HISTORY);
    return succeeded;
  }, [sendOrSchedule]);

  const handleSaveTemplate = useCallback(({ title, message }) => {
    const next = saveTemplate(title, title, message);
    setTemplates(next);
    toast.success('تم حفظ القالب بنجاح.');
  }, []);

  const handleUseTemplate = useCallback((id) => {
    setPendingTemplateId(id);
    setActiveTab(TABS.COMPOSE);
  }, []);

  const handleRequestedTemplateHandled = useCallback(() => {
    setPendingTemplateId(null);
  }, []);

  const handleDeleteTemplate = useCallback((id) => {
    const next = deleteTemplate(id);
    setTemplates(next);
    setPendingTemplateId((current) => current === id ? null : current);
    toast.success('تم حذف القالب.');
  }, []);

  const requestDelete = useCallback((notification) => {
    if (!notification?.id || deleting) return;
    setDeleteTarget(notification);
  }, [deleting]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return false;
    const succeeded = await deleteNotificationFromHistory(deleteTarget);
    if (succeeded) setDeleteTarget(null);
    return succeeded;
  }, [deleteTarget, deleteNotificationFromHistory]);

  const tabMeta = useMemo(() => [
    { key: TABS.COMPOSE, label: 'إرسال إشعار', Icon: Send },
    { key: TABS.HISTORY, label: 'السجل', Icon: History, badge: recentNotifications.length },
    { key: TABS.TEMPLATES, label: 'القوالب', Icon: FileText, badge: templates.length },
  ], [recentNotifications.length, templates.length]);

  if (loading) {
    return (
      <div className="notifications-page space-y-4">
        <SkeletonPageHeader />
        <div className="grid-kpi">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={5} />
        </div>
      </div>
    );
  }

  return (
    <div className="notifications-page space-y-4 pb-20">
      <PageHero
        icon={Bell}
        title="مركز الإشعارات"
        subtitle="إرسال تنبيهات إلى هواتف المشتركين، وجدولة الإشعارات ومراجعة السجل."
        meta={`${users.length} شبكة مسجّلة • ${recentNotifications.length} إشعار في السجل`}
        actions={
          <DataFreshness
            lastSyncedAt={lastSyncAt}
            refreshing={syncing}
            onRefresh={refresh}
          />
        }
      />

      {loadError && (
        <div className="notif-error" role="alert" aria-live="assertive">
          <span className="notif-error__icon" aria-hidden="true"><AlertCircle className="w-5 h-5" /></span>
          <div className="notif-error__body">
            <p className="notif-error__title">تعذّر تحديث بعض البيانات</p>
            <p className="notif-error__msg">يمكنك استخدام البيانات المتاحة ثم إعادة المحاولة لاستعادة السجل وقائمة المشتركين.</p>
          </div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh} disabled={syncing}>
            إعادة المحاولة
          </Button>
        </div>
      )}

      <div className="android-tabs" role="group" aria-label="اختيار قسم الإشعارات">
        {tabMeta.map(({ key, label, Icon, badge }) => (
          <button
            key={key}
            type="button"
            aria-pressed={activeTab === key}
            onClick={() => setActiveTab(key)}
            className={`android-tab min-h-[44px] ${activeTab === key ? 'is-active' : ''}`}
          >
            <Icon className="w-4 h-4 ml-1" aria-hidden="true" />
            <span>{label}</span>
            {typeof badge === 'number' && <span className="android-tab__badge">{badge}</span>}
          </button>
        ))}
      </div>

      <ComposeTab
        users={users}
        templates={templates}
        sending={sending}
        hidden={activeTab !== TABS.COMPOSE}
        requestedTemplateId={pendingTemplateId}
        onRequestedTemplateHandled={handleRequestedTemplateHandled}
        onSend={handleSend}
        onSaveTemplate={handleSaveTemplate}
        onOpenPhoneModal={() => setPhoneModalOpen(true)}
      />

      <HistoryTab
        notifications={recentNotifications}
        deleting={deleting}
        hidden={activeTab !== TABS.HISTORY}
        onRequestDelete={requestDelete}
      />

      <TemplatesTab
        templates={templates}
        hidden={activeTab !== TABS.TEMPLATES}
        onUse={handleUseTemplate}
        onDelete={handleDeleteTemplate}
        onCreate={() => setActiveTab(TABS.COMPOSE)}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="حذف الإشعار"
        message={`هل تريد حذف الإشعار «${deleteTarget?.title || 'بدون عنوان'}» من السجل؟ لا يمكن التراجع عن الحذف.`}
        confirmText={deleting ? 'جارٍ الحذف…' : 'نعم، احذف'}
        variant="danger"
      />

      <PhoneNotificationModal
        isOpen={phoneModalOpen}
        onClose={() => setPhoneModalOpen(false)}
      />
    </div>
  );
}

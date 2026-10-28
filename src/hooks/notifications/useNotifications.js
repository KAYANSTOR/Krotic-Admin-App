import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';

import { useLocalDb } from '../../lib/localDb/LocalDbContext';
import { useLocalQuery } from '../../lib/localDb/useLocalQuery';
import { loadLocalUserOptions, loadLocalNotifications } from '../../lib/localDb/localData';
import { logAdminAction, AUDIT_ACTIONS } from '../../lib/auditLog';
import { sendPushNotification, deleteNotification } from '../../lib/adminApi';
import { scheduleNotificationRequest } from '../../lib/notifications/scheduler';
import { notificationMillis } from '../../lib/notifications/timestamps';
import { AUDIENCE, SEND_ERROR_MESSAGES } from '../../lib/notifications/constants';
import { userOptionLabel } from '../../lib/notifications/templates';

function errorMessage(code) {
  if (code === 'network_error') return 'تعذر الاتصال بالخادم لإرسال الإشعار. تحقق من الإنترنت ثم أعد المحاولة.';
  return SEND_ERROR_MESSAGES[code] || `تعذر تنفيذ الطلب (${code || 'خطأ غير معروف'}).`;
}

function recordAudit(entry) {
  Promise.resolve()
    .then(() => logAdminAction(entry))
    .catch((error) => console.warn('Notification audit write failed:', error));
}

export function useNotifications() {
  const { runSync, syncing, lastSyncAt } = useLocalDb();
  const usersQuery = useLocalQuery((localDb) => loadLocalUserOptions(localDb), []);
  const historyQuery = useLocalQuery((localDb) => loadLocalNotifications(localDb), []);

  const users = useMemo(
    () => Array.isArray(usersQuery.data) ? usersQuery.data : [],
    [usersQuery.data],
  );
  const recentNotifications = useMemo(
    () => (Array.isArray(historyQuery.data) ? historyQuery.data : []).map((data) => ({
      ...data,
      type: data.audienceType
        || (String(data.target || '').startsWith('user:') ? AUDIENCE.USER : AUDIENCE.GLOBAL),
      displayTimestamp: notificationMillis(data),
    })),
    [historyQuery.data],
  );

  const hasAnyData = usersQuery.data != null || historyQuery.data != null;
  const loading = !hasAnyData && (usersQuery.loading || historyQuery.loading);
  const loadError = Boolean(usersQuery.error || historyQuery.error);

  const usersRefreshRef = useRef(usersQuery.refresh);
  const historyRefreshRef = useRef(historyQuery.refresh);
  useEffect(() => { usersRefreshRef.current = usersQuery.refresh; }, [usersQuery.refresh]);
  useEffect(() => { historyRefreshRef.current = historyQuery.refresh; }, [historyQuery.refresh]);

  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const sendingRef = useRef(false);
  const deletingRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      await runSync({ reason: 'manual' });
    } catch (error) {
      console.warn('Notification center sync failed:', error);
      toast.error('تعذرت مزامنة أحدث البيانات؛ ستبقى البيانات المحلية معروضة.');
    } finally {
      usersRefreshRef.current();
      historyRefreshRef.current();
    }
  }, [runSync]);

  const targetLabelForUser = useCallback((uid) => {
    const user = users.find((item) => item.uid === uid);
    return user ? userOptionLabel(user) : uid;
  }, [users]);

  const sendOrSchedule = useCallback(async ({
    type,
    selectedUser,
    title,
    message,
    scheduledAt,
  }) => {
    if (sendingRef.current) return false;

    const cleanTitle = String(title || '').trim();
    const cleanMessage = String(message || '').trim();
    if (!cleanTitle || !cleanMessage) {
      toast.error('يرجى ملء عنوان الإشعار ونصه.');
      return false;
    }
    if (type === AUDIENCE.USER && !selectedUser) {
      toast.error('يرجى اختيار المشترك المستلم.');
      return false;
    }

    let scheduledMs = null;
    if (scheduledAt) {
      scheduledMs = new Date(scheduledAt).getTime();
      if (!Number.isFinite(scheduledMs) || scheduledMs < Date.now() + 60_000) {
        toast.error('اختر وقتاً مستقبلياً يتجاوز دقيقة واحدة على الأقل.');
        return false;
      }
    }

    sendingRef.current = true;
    setSending(true);
    try {
      const targetUid = type === AUDIENCE.USER ? selectedUser : null;
      const targetLabel = targetUid ? targetLabelForUser(targetUid) : 'جميع المستخدمين';
      if (scheduledMs !== null) {
        await scheduleNotificationRequest({
          title: cleanTitle,
          body: cleanMessage,
          audienceType: type,
          targetUid,
          scheduledAtMs: scheduledMs,
        });
        recordAudit({
          action: AUDIT_ACTIONS.NOTIFICATION_SCHEDULE,
          targetType: targetUid ? 'user' : 'broadcast',
          targetId: targetUid || 'all',
          targetLabel,
          details: {
            title: cleanTitle,
            scheduled_at: new Date(scheduledMs).toISOString(),
          },
        });
        toast.success('تمت جدولة الإشعار بنجاح.');
      } else {
        const result = await sendPushNotification({
          title: cleanTitle,
          body: cleanMessage,
          targetUid,
        });
        if (!result.ok) {
          toast.error(errorMessage(result.error));
          return false;
        }

        recordAudit({
          action: AUDIT_ACTIONS.NOTIFICATION_SEND,
          targetType: targetUid ? 'user' : 'broadcast',
          targetId: targetUid || 'all',
          targetLabel,
          details: { title: cleanTitle, sent: result.data?.sent ?? 1 },
        });
        toast.success(
          targetUid
            ? `تم إرسال الإشعار إلى ${targetLabel} بنجاح.`
            : 'تم إرسال الإشعار لجميع الأجهزة المستهدفة بنجاح.',
        );
      }

      await refresh();
      return true;
    } catch (error) {
      console.error(scheduledMs !== null ? 'Notification scheduling failed:' : 'Notification send failed:', error);
      toast.error(
        scheduledMs !== null
          ? 'تعذر جدولة الإشعار. تحقق من صلاحية حسابك والاتصال.'
          : 'تعذر الاتصال بالخادم لإرسال الإشعار.',
      );
      return false;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [refresh, targetLabelForUser]);

  const deleteNotificationFromHistory = useCallback(async (notification) => {
    if (!notification?.id || deletingRef.current) return false;

    deletingRef.current = true;
    setDeleting(true);
    try {
      const result = await deleteNotification({ id: notification.id });
      if (!result.ok) {
        toast.error(errorMessage(result.error));
        return false;
      }

      recordAudit({
        action: AUDIT_ACTIONS.NOTIFICATION_DELETE,
        targetType: 'notification',
        targetId: notification.id,
        targetLabel: notification.title || '',
      });
      toast.success('تم حذف الإشعار من السجل.');
      await refresh();
      return true;
    } catch (error) {
      console.error('Notification deletion failed:', error);
      toast.error('تعذر حذف الإشعار. أعد المحاولة.');
      return false;
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }, [refresh]);

  return {
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
  };
}

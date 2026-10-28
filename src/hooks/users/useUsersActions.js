import { useCallback } from 'react';
import { Timestamp } from 'firebase/firestore';
import toast from 'react-hot-toast';
import {
  renewNetwork,
  updateNetworkAccess,
  deleteNetworkAccount,
  adminApiError,
} from '../../lib/adminApi.js';
import { logAdminAction, AUDIT_ACTIONS } from '../../lib/auditLog.js';
import { isUserPhoneVerified } from '../../lib/accessStatus.js';
import {
  deriveActiveFromStatus,
  deriveTrialFromStatus,
  normalizeTimestampValue,
  hasExpiryCompatibilityGap,
} from '../../lib/users/accessHelpers.js';

export function useUsersActions({
  setUsers,
  setConfirmAction,
  setEditingUser,
  syncInBackground,
}) {
  const applyLocalUpdate = useCallback((uid, updater) => {
    setUsers((previous) => previous.map((user) => (
      user.uid === uid ? updater(user) : user
    )));
  }, [setUsers]);

  const handleToggleActive = useCallback((user) => {
    const newStatus = !user.is_active;
    const accessStatus = newStatus ? 'ACTIVE_PAID' : 'SUSPENDED_GRACE';

    setConfirmAction({
      user,
      title: newStatus ? 'تفعيل المشترك' : 'حظر المشترك',
      message: newStatus
        ? `هل تريد تفعيل حساب "${user.networkName || user.uid}"؟`
        : `هل تريد حظر "${user.networkName || user.uid}"؟ سيتم منعه من استخدام التطبيق فوراً.`,
      variant: newStatus ? 'success' : 'danger',
      action: async () => {
        const result = await updateNetworkAccess({ uid: user.uid, accessStatus });
        if (!result.ok) {
          toast.error(adminApiError(result.error, 'تعذر تحديث حالة المستخدم'));
          return false;
        }

        applyLocalUpdate(user.uid, (current) => {
          const next = {
            ...current,
            accessStatus,
            is_active: newStatus,
            is_trial: false,
          };
          return { ...next, accessNeedsRepair: hasExpiryCompatibilityGap(next) };
        });

        logAdminAction({
          action: newStatus ? AUDIT_ACTIONS.USER_ACTIVATE : AUDIT_ACTIONS.USER_BLOCK,
          targetType: 'user',
          targetId: user.uid,
          targetLabel: user.networkName || user.phoneNumber || user.uid,
        }).catch(() => {});
        toast.success(newStatus ? 'تم تفعيل الحساب' : 'تم حظر الحساب');
        syncInBackground();
        return true;
      },
    });
  }, [setConfirmAction, applyLocalUpdate, syncInBackground]);

  // Kept for parity with the existing action contract; not exposed in the current UI.
  const handleMakeOfficial = useCallback((user) => {
    setConfirmAction({
      user,
      title: 'تحويل الحساب إلى رسمي',
      message: `هل تريد تحويل "${user.networkName || user.uid}" من مستخدم تجريبي إلى حساب رسمي دائم؟`,
      variant: 'primary',
      action: async () => {
        const result = await updateNetworkAccess({ uid: user.uid, accessStatus: 'ACTIVE_PAID' });
        if (!result.ok) {
          toast.error(adminApiError(result.error, 'تعذر تحويل المستخدم إلى رسمي'));
          return false;
        }

        applyLocalUpdate(user.uid, (current) => {
          const next = {
            ...current,
            accessStatus: 'ACTIVE_PAID',
            is_active: true,
            is_trial: false,
          };
          return { ...next, accessNeedsRepair: hasExpiryCompatibilityGap(next) };
        });

        logAdminAction({
          action: AUDIT_ACTIONS.USER_MAKE_OFFICIAL,
          targetType: 'user',
          targetId: user.uid,
          targetLabel: user.networkName || user.phoneNumber || user.uid,
        }).catch(() => {});
        toast.success('تم تحويل الحساب إلى رسمي بنجاح');
        syncInBackground();
        return true;
      },
    });
  }, [setConfirmAction, applyLocalUpdate, syncInBackground]);

  const handleQuickRenew = useCallback((user) => {
    setConfirmAction({
      user,
      title: 'تجديد اشتراك سريع',
      message: 'سيتم تمديد الوصول 30 يوماً إضافية للشبكة. هل أنت متأكد؟',
      variant: 'success',
      action: async () => {
        const result = await renewNetwork(user.uid, 30);
        if (!result.ok) {
          toast.error(adminApiError(result.error, 'تعذر التجديد'));
          return false;
        }

        const newEnd = normalizeTimestampValue(result.data?.subscriptionEndsAt);
        const endMillis = newEnd?.toMillis?.() ?? null;
        applyLocalUpdate(user.uid, (current) => {
          const next = {
            ...current,
            accessStatus: 'ACTIVE_PAID',
            is_active: true,
            is_trial: false,
            ...(newEnd ? {
              subscriptionEndsAt: newEnd,
              subscription_end_date: newEnd,
            } : {}),
          };
          return { ...next, accessNeedsRepair: hasExpiryCompatibilityGap(next) };
        });

        logAdminAction({
          action: AUDIT_ACTIONS.USER_RENEW,
          targetType: 'user',
          targetId: user.uid,
          targetLabel: user.networkName || user.phoneNumber || user.uid,
          details: { subscriptionEndsAt: endMillis },
        }).catch(() => {});
        toast.success('تم تجديد الاشتراك بنجاح لمدة 30 يوماً');
        syncInBackground();
        return true;
      },
    });
  }, [setConfirmAction, applyLocalUpdate, syncInBackground]);

  const handleSaveEdit = useCallback(async (uid, updates) => {
    const result = await updateNetworkAccess({ uid, ...updates });
    if (!result.ok) {
      toast.error(adminApiError(result.error, 'تعذر حفظ التعديلات'));
      return false;
    }

    const normalizedEnd = updates.subscriptionEndsAt != null
      ? normalizeTimestampValue(updates.subscriptionEndsAt)
      : null;

    applyLocalUpdate(uid, (current) => {
      const activeFromStatus = deriveActiveFromStatus(updates.accessStatus);
      const trialFromStatus = deriveTrialFromStatus(updates.accessStatus);
      const next = {
        ...current,
        ...updates,
        ...(activeFromStatus !== undefined ? { is_active: activeFromStatus } : {}),
        ...(trialFromStatus !== undefined ? { is_trial: trialFromStatus } : {}),
        ...(updates.phone_verified !== undefined ? {
          phone_verified: Boolean(updates.phone_verified),
          phoneVerified: Boolean(updates.phone_verified),
          ...(updates.phone_verified ? { phone_verified_manual: true } : {}),
        } : {}),
        ...(normalizedEnd ? {
          subscriptionEndsAt: normalizedEnd,
          subscription_end_date: normalizedEnd,
        } : {}),
      };
      return { ...next, accessNeedsRepair: hasExpiryCompatibilityGap(next) };
    });

    setEditingUser(null);
    logAdminAction({
      action: AUDIT_ACTIONS.USER_EDIT,
      targetType: 'user',
      targetId: uid,
      targetLabel: uid,
      details: {
        commission_rate: updates.commission_rate ?? null,
        has_custom_warning: updates.has_custom_warning ?? null,
        subscriptionEndsAt: updates.subscriptionEndsAt ?? null,
        phone_verified: updates.phone_verified ?? null,
      },
    }).catch(() => {});
    toast.success('تم حفظ التعديلات بنجاح');
    syncInBackground();
    return true;
  }, [applyLocalUpdate, setEditingUser, syncInBackground]);

  const handleManualPhoneVerify = useCallback((user) => {
    const isVerified = isUserPhoneVerified(user);
    const targetName = user.networkName || user.phoneNumber || user.uid;
    const phoneDisplay = user.phoneNumber || user.phone || 'غير مسجّل';

    if (!isVerified) {
      setConfirmAction({
        user,
        title: 'توثيق الهاتف يدوياً',
        message: `توثيق حساب «${targetName}» (${phoneDisplay}) يدوياً؟ يُستخدم عند تعذر وصول رمز SMS.`,
        variant: 'success',
        action: async () => {
          const result = await updateNetworkAccess({ uid: user.uid, phone_verified: true });
          if (!result.ok) {
            toast.error(adminApiError(result.error, 'تعذر تفعيل التحقق من الهاتف'));
            return false;
          }

          applyLocalUpdate(user.uid, (current) => ({
            ...current,
            phone_verified: true,
            phoneVerified: true,
            phone_verified_at: Timestamp.now(),
            verified_by_admin: true,
            phone_verified_manual: true,
          }));
          logAdminAction({
            action: AUDIT_ACTIONS.USER_PHONE_VERIFY_MANUAL,
            targetType: 'user',
            targetId: user.uid,
            targetLabel: targetName,
            details: { phone: phoneDisplay, manual: true, reason: 'دعم فني - تفعيل يدوي' },
          }).catch(() => {});
          toast.success(`تم تفعيل وتوثيق حساب «${targetName}» برقم الهاتف بنجاح`);
          syncInBackground();
          return true;
        },
      });
      return;
    }

    setConfirmAction({
      user,
      title: 'إلغاء توثيق الهاتف',
      message: `إلغاء توثيق «${targetName}» (${phoneDisplay})؟`,
      variant: 'danger',
      action: async () => {
        const result = await updateNetworkAccess({ uid: user.uid, phone_verified: false });
        if (!result.ok) {
          toast.error(adminApiError(result.error, 'تعذر إلغاء توثيق الهاتف'));
          return false;
        }

        applyLocalUpdate(user.uid, (current) => ({
          ...current,
          phone_verified: false,
          phoneVerified: false,
          phone_verified_manual: false,
        }));
        logAdminAction({
          action: AUDIT_ACTIONS.USER_PHONE_UNVERIFY,
          targetType: 'user',
          targetId: user.uid,
          targetLabel: targetName,
          details: { phone: phoneDisplay },
        }).catch(() => {});
        toast.success(`تم إلغاء توثيق الهاتف لحساب «${targetName}»`);
        syncInBackground();
        return true;
      },
    });
  }, [setConfirmAction, applyLocalUpdate, syncInBackground]);

  const handleDeleteUser = useCallback((user) => {
    const targetName = user.networkName || user.network_name || user.phone || user.uid;
    setConfirmAction({
      user,
      title: 'حذف حساب المشترك والشبكة',
      message: `حذف حساب «${targetName}» نهائياً مع كل بياناته؟ لا يمكن التراجع.`,
      variant: 'danger',
      action: async () => {
        const result = await deleteNetworkAccount(user.uid);
        if (!result.ok) {
          toast.error(adminApiError(result.error, 'تعذر حذف الحساب'));
          return false;
        }

        logAdminAction({
          action: AUDIT_ACTIONS.USER_DELETE,
          targetType: 'user',
          targetId: user.uid,
          targetLabel: targetName,
          details: { networkId: user.networkId || null },
        }).catch(() => {});
        setUsers((previous) => previous.filter((current) => current.uid !== user.uid));
        toast.success(`تم حذف الحساب «${targetName}» بنجاح`);
        syncInBackground();
        return true;
      },
    });
  }, [setUsers, setConfirmAction, syncInBackground]);

  return {
    handleToggleActive,
    handleMakeOfficial,
    handleQuickRenew,
    handleSaveEdit,
    handleManualPhoneVerify,
    handleDeleteUser,
  };
}

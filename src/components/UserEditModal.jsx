import { X } from 'lucide-react';
import { useState, useEffect } from 'react';

export default function UserEditModal({ isOpen, onClose, user, onSave }) {
  const [hasCustomWarning, setHasCustomWarning] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [commissionRate, setCommissionRate] = useState('');
  const [subscriptionEnd, setSubscriptionEnd] = useState('');

  useEffect(() => {
    if (user && isOpen) {
      setHasCustomWarning(!!user.has_custom_warning);
      setWarningMessage(user.warning_message || '');
      setCommissionRate(user.commission_rate != null ? user.commission_rate : '');
      setSubscriptionEnd(getDateString(user.subscription_end_date));
    }
  }, [user, isOpen]);

  if (!isOpen || !user) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const updates = {};

    if (subscriptionEnd) {
      updates.subscription_end_date = new Date(subscriptionEnd);
    }

    if (commissionRate !== '') {
      updates.commission_rate = parseFloat(commissionRate);
    } else {
      updates.commission_rate = null; // null means use global
    }

    updates.has_custom_warning = hasCustomWarning;
    if (hasCustomWarning) {
      updates.warning_message = warningMessage;
    } else {
      updates.warning_message = '';
    }

    onSave(user.uid, updates);
  };

  // Convert Firestore timestamp to date string for input
  function getDateString(timestamp) {
    if (!timestamp) return '';
    let date;
    if (timestamp.toDate) {
      date = timestamp.toDate();
    } else if (timestamp.seconds) {
      date = new Date(timestamp.seconds * 1000);
    } else if (typeof timestamp === 'number') {
      date = new Date(timestamp);
    } else {
      date = new Date(timestamp);
    }
    return date.toISOString().split('T')[0];
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-gray-900">
            تعديل بيانات: {user.networkName || 'مستخدم'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Subscription End Date */}
          <div>
            <label className="label-field">تاريخ انتهاء الاشتراك</label>
            <input
              type="date"
              value={subscriptionEnd}
              onChange={(e) => setSubscriptionEnd(e.target.value)}
              className="input-field"
            />
          </div>

          {/* Commission Rate */}
          <div>
            <label className="label-field">العمولة الخاصة (%)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={commissionRate}
              onChange={(e) => setCommissionRate(e.target.value)}
              className="input-field"
              placeholder="اتركه فارغاً لاستخدام العمولة العامة"
            />
            <p className="text-xs text-gray-500 mt-1">
              إذا تركته فارغاً أو صفر، سيتم حساب أرباح هذا الحساب بناءً على النسبة العامة.
            </p>
          </div>

          {/* Custom Warning Toggle */}
          <div className="border-t pt-4">
            <div className="flex items-center gap-3 mb-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasCustomWarning}
                  onChange={(e) => setHasCustomWarning(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:right-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
              </label>
              <span className="text-sm font-medium text-gray-900">
                تخصيص رسالة تحذير لهذا المستخدم
              </span>
            </div>
            
            {hasCustomWarning && (
              <div>
                <textarea
                  value={warningMessage}
                  onChange={(e) => setWarningMessage(e.target.value)}
                  rows={3}
                  className="input-field resize-none"
                  placeholder="أدخل رسالة التحذير الخاصة هنا..."
                  required={hasCustomWarning}
                />
              </div>
            )}
            {!hasCustomWarning && (
              <p className="text-xs text-gray-500">
                التطبيق سيعرض رسالة التحذير العامة المحددة في الإعدادات.
              </p>
            )}
          </div>

          <div className="flex gap-3 justify-end pt-4 border-t">
            <button type="button" onClick={onClose} className="btn-secondary">
              إلغاء
            </button>
            <button type="submit" className="btn-primary">
              حفظ التعديلات
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

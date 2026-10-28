import {
  DollarSign, CalendarPlus, Edit, KeyRound, Ban,
  UserCheck, CheckCircle, ShieldCheck, ShieldAlert, Trash2, ChevronDown,
} from 'lucide-react';
import Section from '../ui/Section';
import { Card } from '../ui/Card';
import Badge from '../ui/Badge';
import { hasCustomCommission } from '../../lib/users/profileHelpers';

export default function UserProfileAccountSection({
  user, uid, status, expired, isVerifiedPhone,
  onOpenBilling, onRenew, onEdit, onOpenAuth, onVerifyPhone,
  onMakeOfficial, onToggleAccess, onDelete,
}) {
  return (
          <Section
            eyebrow="الحساب"
            title="تفاصيل وإجراءات سريعة"
            action={
              <div className="flex items-center gap-2 flex-wrap">
                <Badge tone={status.tone}>{status.text}</Badge>
                {user.is_active === false && <Badge tone="danger">محظور</Badge>}
              </div>
            }
          >
            <Card>
              <dl className="user-card__meta" style={{ background: 'transparent', border: 0, padding: 0 }}>
                <div className="user-card__meta-item">
                  <dt>النسبة المضبوطة حالياً</dt>
                  <dd><span className="num font-bold">{hasCustomCommission(user) ? `${user.commission_rate}% (خاصة)` : 'عامة'}</span></dd>
                </div>
                <div className="user-card__meta-item">
                  <dt>تاريخ الانتهاء</dt>
                  <dd className={expired ? 'text-danger font-bold' : 'font-semibold'}>{formatDate(user.subscription_end_date)}</dd>
                </div>
                <div className="user-card__meta-item">
                  <dt>معرّف الشبكة</dt>
                  <dd dir="ltr" className="font-mono">{user.networkId || uid}</dd>
                </div>
                <div className="user-card__meta-item">
                  <dt>رقم الهاتف</dt>
                  <dd dir="ltr" className="font-mono font-bold text-brand">{user.phoneNumber || user.phone || '—'}</dd>
                </div>
                <div className="user-card__meta-item">
                  <dt>حالة التحقق بالهاتف</dt>
                  <dd>
                    {isVerifiedPhone ? (
                      <span className="inline-flex items-center gap-1 font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200 text-xs">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                        <span>موثّق برقم الهاتف</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200 text-xs">
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
                        <span>غير موثّق</span>
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
    
              <div className="user-card__actions mt-4">
                <button type="button" onClick={onOpenBilling} className="row-action row-action--success min-h-[44px]" aria-label="الفوترة والتسويات">
                  <DollarSign className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                  <span className="text-xs font-bold">تسوية وعمولة</span>
                </button>
                <button type="button" onClick={onRenew} className="row-action row-action--brand min-h-[44px]">
                  <CalendarPlus className="w-4 h-4 text-brand" aria-hidden="true" />
                  <span>تجديد</span>
                </button>
                <button type="button" onClick={onEdit} className="row-action row-action--neutral min-h-[44px]">
                  <Edit className="w-4 h-4" aria-hidden="true" />
                  <span>تعديل</span>
                </button>
                <button type="button" onClick={onOpenAuth} className="row-action row-action--neutral min-h-[44px]">
                  <KeyRound className="w-4 h-4" aria-hidden="true" />
                  <span>الدخول</span>
                </button>
              </div>
    
              <details className="mt-3 border-t border-line/60 pt-3">
                <summary className="flex items-center justify-between gap-2 cursor-pointer rounded-xl px-3 py-2 min-h-[44px] font-bold text-sm text-ink hover:bg-surface-sunken">
                  <span>إجراءات إضافية</span>
                  <ChevronDown className="w-4 h-4 text-muted" aria-hidden="true" />
                </summary>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3">
                  <button
                    type="button"
                    onClick={onVerifyPhone}
                    className={`row-action min-h-[44px] ${isVerifiedPhone ? 'row-action--success' : 'row-action--brand-soft'}`}
                    title={isVerifiedPhone ? 'إلغاء توثيق الهاتف' : 'توثيق الهاتف يدوياً للدعم الفني'}
                  >
                    {isVerifiedPhone ? <ShieldCheck className="w-4 h-4 text-emerald-600" /> : <ShieldAlert className="w-4 h-4 text-amber-600" />}
                    <span>{isVerifiedPhone ? 'إلغاء التوثيق' : 'توثيق الهاتف'}</span>
                  </button>
    
                  {user.is_trial && (
                    <button type="button" onClick={onMakeOfficial} className="row-action row-action--brand-soft min-h-[44px]">
                      <CheckCircle className="w-4 h-4 text-brand" aria-hidden="true" />
                      <span>تحويل إلى رسمي</span>
                    </button>
                  )}
    
                  <button
                    type="button"
                    onClick={onToggleAccess}
                    className={`row-action min-h-[44px] ${user.is_active === false ? 'row-action--success' : 'row-action--danger'}`}
                    aria-label={user.is_active === false ? 'إلغاء حظر المستخدم' : 'حظر المستخدم'}
                  >
                    {user.is_active === false ? <UserCheck className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                    <span>{user.is_active === false ? 'رفع الحظر' : 'حظر'}</span>
                  </button>
    
                  <button type="button" onClick={onDelete} className="row-action row-action--danger min-h-[44px]" title="حذف الحساب نهائياً">
                    <Trash2 className="w-4 h-4 text-danger" aria-hidden="true" />
                    <span>حذف الحساب</span>
                  </button>
                </div>
              </details>
            </Card>
          </Section>
  );
}

import { useState, useEffect, useCallback } from 'react';
import {
  KeyRound, RefreshCw, Copy, Check, Eye, EyeOff, ShieldAlert, Mail, Phone,
  Clock, CalendarDays, Fingerprint, BadgeCheck, AlertTriangle, Link2, Send,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from './ui/Modal';
import Button from './ui/Button';
import Badge from './ui/Badge';
import { Field, Input } from './ui/Field';
import { SkeletonLine } from './ui/Skeleton';
import { callAdminApi, adminApiError } from '../lib/adminApi';
import { logAdminAction, AUDIT_ACTIONS } from '../lib/auditLog';
import { formatDate } from '../lib/format';

const ENDPOINT = '/api/manage-user-auth';
const MIN_PASSWORD_LENGTH = 6;

const PROVIDER_LABELS = {
  password: 'بريد وكلمة مرور',
  phone: 'رقم هاتف',
  'google.com': 'حساب Google',
  'apple.com': 'حساب Apple',
  'facebook.com': 'حساب Facebook',
};

async function copyText(value, onDone) {
  if (!value) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
    onDone();
  } catch (error) {
    console.error('copy failed', error);
    toast.error('تعذر النسخ، انسخ النص يدوياً.');
  }
}

function CopyButton({ value, label, copiedKey, copied, onCopied }) {
  if (!value) return null;
  const isCopied = copied === copiedKey;
  return (
    <button
      type="button"
      className="copy-btn"
      onClick={() => copyText(value, () => onCopied(copiedKey))}
      aria-label={label}
      title={label}
    >
      {isCopied ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
    </button>
  );
}

export default function UserAuthModal({ isOpen, onClose, user }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [issuedPassword, setIssuedPassword] = useState(null);
  const [copied, setCopied] = useState('');
  const [resetLink, setResetLink] = useState(null);
  const [creatingLink, setCreatingLink] = useState(false);

  const load = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    setLoadError(null);
    const result = await callAdminApi(ENDPOINT, { action: 'get', uid: user.uid });
    if (result.ok) {
      setInfo(result.data.user);
    } else {
      setInfo(null);
      setLoadError(adminApiError(result.error));
    }
    setLoading(false);
  }, [user?.uid]);

  useEffect(() => {
    if (!isOpen || !user?.uid) return;
    setPassword('');
    setConfirm('');
    setShowPassword(false);
    setIssuedPassword(null);
    setResetLink(null);
    setCopied('');
    load();
  }, [isOpen, user?.uid, load]);

  if (!isOpen || !user) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      toast.error(`كلمة المرور يجب أن تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل`);
      return;
    }
    if (password !== confirm) {
      toast.error('كلمتا المرور غير متطابقتين');
      return;
    }

    setSaving(true);
    const result = await callAdminApi(ENDPOINT, {
      action: 'set-password',
      uid: user.uid,
      password,
    });
    setSaving(false);

    if (!result.ok) {
      toast.error(adminApiError(result.error));
      return;
    }

    setInfo(result.data.user);
    setIssuedPassword(password);
    logAdminAction({
      action: AUDIT_ACTIONS.USER_PASSWORD_SET,
      targetType: 'user',
      targetId: user.uid,
      targetLabel: user.networkName || user.phoneNumber || user.uid,
    });
    setPassword('');
    setConfirm('');
    setShowPassword(false);
    toast.success('تم تعيين كلمة مرور جديدة بنجاح');
  };

  const handleCreateResetLink = async () => {
    setCreatingLink(true);
    const result = await callAdminApi(ENDPOINT, { action: 'reset-link', uid: user.uid });
    setCreatingLink(false);

    if (!result.ok) {
      toast.error(adminApiError(result.error));
      return;
    }

    setResetLink(result.data.link);
    logAdminAction({
      action: AUDIT_ACTIONS.USER_RESET_LINK,
      targetType: 'user',
      targetId: user.uid,
      targetLabel: user.networkName || user.phoneNumber || user.uid,
    });
    toast.success('تم إنشاء رابط إعادة التعيين');
  };

  const loginPhone = user.phoneNumber || user.phone || '';
  const whatsappNumber = loginPhone.replace(/[^0-9]/g, '');
  const whatsappHref = resetLink && whatsappNumber
    ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`رابط إعادة تعيين كلمة المرور الخاصة بك:
${resetLink}`)}`
    : null;
  const networkName = user.networkName || user.uid;
  const providerLabels = (info?.providers || []).map((p) => PROVIDER_LABELS[p] || p);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      icon={KeyRound}
      title="بيانات دخول العميل"
      description={`حساب: ${networkName}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>إغلاق</Button>
          <Button
            variant="primary"
            type="submit"
            form="user-auth-form"
            icon={KeyRound}
            loading={saving}
            disabled={!info || loading}
          >
            تعيين كلمة المرور
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="space-y-4" aria-hidden="true">
          <SkeletonLine className="w-1/3 h-6" />
          <SkeletonLine className="w-full h-12 rounded-[14px]" />
          <SkeletonLine className="w-full h-12 rounded-[14px]" />
          <SkeletonLine className="w-2/3 h-12 rounded-[14px]" />
        </div>
      ) : loadError ? (
        <div className="auth-error" role="alert">
          <span className="auth-error__icon" aria-hidden="true">
            <AlertTriangle className="w-5 h-5" />
          </span>
          <div className="auth-error__body">
            <p className="auth-error__title">تعذر جلب بيانات الدخول</p>
            <p className="auth-error__msg">{loadError}</p>
          </div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={load}>
            إعادة المحاولة
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <dl className="auth-info">
            <div className="auth-info__row auth-info__row--primary">
              <dt className="auth-info__label"><Phone className="w-4 h-4" aria-hidden="true" />رقم الدخول (يكتبه العميل)</dt>
              <dd className="auth-info__value">
                <span className="mono-value mono-value--strong" dir="ltr">{loginPhone || '—'}</span>
                <CopyButton
                  value={loginPhone} label="نسخ رقم الدخول"
                  copiedKey="phone" copied={copied} onCopied={setCopied}
                />
              </dd>
            </div>

            <div className="auth-info__row">
              <dt className="auth-info__label"><Mail className="w-4 h-4" aria-hidden="true" />معرّف داخلي في Firebase</dt>
              <dd className="auth-info__value">
                <span className="mono-value" dir="ltr">{info.email || 'غير متوفر'}</span>
                <CopyButton
                  value={info.email} label="نسخ المعرّف الداخلي"
                  copiedKey="email" copied={copied} onCopied={setCopied}
                />
              </dd>
            </div>

            <div className="auth-info__row">
              <dt className="auth-info__label"><Fingerprint className="w-4 h-4" aria-hidden="true" />نوع الدخول</dt>
              <dd className="auth-info__value">
                {providerLabels.length ? providerLabels.join(' • ') : '—'}
              </dd>
            </div>

            <div className="auth-info__row">
              <dt className="auth-info__label"><BadgeCheck className="w-4 h-4" aria-hidden="true" />حالة الحساب</dt>
              <dd className="auth-info__value">
                <Badge tone={info.disabled ? 'danger' : 'success'} dot>
                  {info.disabled ? 'معطّل في المصادقة' : 'مفعّل'}
                </Badge>
                {info.email && (
                  <Badge tone={info.emailVerified ? 'success' : 'warning'}>
                    {info.emailVerified ? 'البريد موثّق' : 'البريد غير موثّق'}
                  </Badge>
                )}
              </dd>
            </div>

            <div className="auth-info__row">
              <dt className="auth-info__label"><CalendarDays className="w-4 h-4" aria-hidden="true" />تاريخ إنشاء الحساب</dt>
              <dd className="auth-info__value">{formatDate(info.createdAt, { withTime: true })}</dd>
            </div>

            <div className="auth-info__row">
              <dt className="auth-info__label"><Clock className="w-4 h-4" aria-hidden="true" />آخر تسجيل دخول</dt>
              <dd className="auth-info__value">
                {info.lastSignInAt ? formatDate(info.lastSignInAt, { withTime: true }) : 'لم يسجّل الدخول بعد'}
              </dd>
            </div>
          </dl>

          <p className="auth-note">
            <ShieldAlert className="w-4 h-4" aria-hidden="true" />
            <span>
              <strong>كلمة المرور فقط قابلة للتعديل.</strong> بريد الدخول ورقم الهاتف لا يمكن
              تغييرهما من هنا لأن التطبيق يشتقّ بريد الدخول من رقم هاتف العميل، وأي تغيير له
              سيمنع العميل من الدخول. ولا يمكن عرض كلمة المرور الحالية لأن Firebase يخزّنها
              كتجزئة مشفّرة؛ يمكن تعيين كلمة مرور جديدة أو إنشاء رابط يعدّل به العميل كلمة مروره.
            </span>
          </p>

          {info.providers?.length && !info.providers.includes('password') ? (
            <p className="auth-warn">
              <AlertTriangle className="w-4 h-4" aria-hidden="true" />
              هذا الحساب لا يستخدم الدخول بالبريد وكلمة المرور حالياً؛ تعيين كلمة مرور سيضيف
              طريقة دخول إضافية ولن يلغي الطريقة الحالية.
            </p>
          ) : null}

          {issuedPassword ? (
            <div className="auth-issued" role="status" aria-live="polite">
              <p className="auth-issued__title">
                <Check className="w-4 h-4" aria-hidden="true" />
                تم تعيين كلمة المرور الجديدة
              </p>
              <div className="auth-issued__value">
                <span className="mono-value" dir="ltr">{issuedPassword}</span>
                <CopyButton
                  value={issuedPassword} label="نسخ كلمة المرور"
                  copiedKey="issued" copied={copied} onCopied={setCopied}
                />
              </div>
              <p className="auth-issued__hint">
                انسخها الآن وأرسلها للعميل بطريقة آمنة، ثم اطلب منه تغييرها من التطبيق.
                لن تُعرض مرة أخرى بعد إغلاق هذه النافذة.
              </p>
            </div>
          ) : null}

          <form id="user-auth-form" onSubmit={handleSubmit} className="space-y-4">
            <Field
              label="كلمة المرور الجديدة"
              hint={`${MIN_PASSWORD_LENGTH} أحرف على الأقل. سيتم استبدال كلمة المرور القديمة فوراً.`}
            >
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                endAdornment={
                  <button
                    type="button"
                    className="field-adorn"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />
            </Field>

            <Field label="تأكيد كلمة المرور">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </Field>
          </form>

          <div className="auth-reset">
            <div className="auth-reset__head">
              <span className="auth-reset__icon" aria-hidden="true">
                <Link2 className="w-4 h-4" />
              </span>
              <div>
                <p className="auth-reset__title">إعادة التعيين بواسطة العميل</p>
                <p className="auth-reset__desc">
                  أنشئ رابطاً مؤقتاً وأرسله للعميل، فيفتحه ويضع كلمة مرور جديدة بنفسه دون أن
                  تعرفها أنت.
                </p>
              </div>
            </div>

            {resetLink ? (
              <>
                <div className="auth-issued__value auth-issued__value--link">
                  <span className="mono-value" dir="ltr" title={resetLink}>{resetLink}</span>
                  <CopyButton
                    value={resetLink} label="نسخ رابط إعادة التعيين"
                    copiedKey="reset" copied={copied} onCopied={setCopied}
                  />
                </div>
                <div className="auth-reset__actions">
                  {whatsappHref && (
                    <Button
                      as="a"
                      href={whatsappHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      variant="success"
                      size="sm"
                      icon={Send}
                    >
                      إرسال عبر واتساب
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" icon={RefreshCw} onClick={handleCreateResetLink} loading={creatingLink}>
                    إنشاء رابط جديد
                  </Button>
                </div>
                <p className="auth-reset__hint">
                  الرابط صالح لمدة ساعة وينتهي بعد استخدامه. أرسله عبر قناة آمنة، ولا تعرضه هنا
                  مرة أخرى بعد إغلاق النافذة.
                </p>
              </>
            ) : (
              <Button
                variant="secondary"
                icon={Link2}
                loading={creatingLink}
                onClick={handleCreateResetLink}
              >
                إنشاء رابط إعادة تعيين كلمة المرور
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { LogIn, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '../components/ui/Button';
import { Field, Input } from '../components/ui/Field';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [validationErrors, setValidationErrors] = useState({ email: '', password: '' });
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const emailInput = form.elements.email;
    const passwordInput = form.elements.password;
    const errors = {
      email: !email.trim()
        ? 'أدخل البريد الإلكتروني.'
        : (!emailInput?.validity.valid ? 'أدخل بريدًا إلكترونيًا صحيحًا.' : ''),
      password: !password ? 'أدخل كلمة المرور.' : '',
    };
    setValidationErrors(errors);
    if (errors.email || errors.password) {
      setFormError('تحقق من الحقول المحددة ثم حاول مرة أخرى.');
      form.querySelector(':invalid')?.focus();
      return;
    }

    setFormError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
      toast.success('تم تسجيل الدخول بنجاح');
      navigate('/');
    } catch (error) {
      console.error('Admin sign-in failed:', error);
      const message = String(error?.message || '');
      if (message.includes('ليس مسجلاً كمدير')) {
        toast.error(message);
      } else if (error?.code === 'permission-denied') {
        toast.error('تعذر التحقق من صلاحيات المدير. تواصل مع مسؤول النظام.');
      } else if (error?.code === 'auth/network-request-failed') {
        toast.error('تعذر الاتصال بخدمة تسجيل الدخول. تحقق من الإنترنت ثم حاول مرة أخرى.');
      } else if (
        error?.code === 'auth/invalid-credential' ||
        error?.code === 'auth/wrong-password' ||
        error?.code === 'auth/user-not-found'
      ) {
        toast.error('البريد الإلكتروني أو كلمة المرور غير صحيحة');
      } else if (error?.code === 'auth/too-many-requests') {
        toast.error('محاولات كثيرة. الرجاء الانتظار قليلاً.');
      } else {
        toast.error('حدث خطأ أثناء تسجيل الدخول');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-10">
          <div className="login-brand-mark">
            <img src="/icons/krotak-pro-192.png" alt="كروتك برو" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">كروتك برو</h1>
          <p className="text-ink-tertiary mt-2 text-sm">لوحة التحكم الإدارية</p>
        </div>

        <div className="login-panel">
          <div className="login-panel__head">
            <span className="icon-tile icon-tile--brand icon-tile--lg" aria-hidden="true">
              <ShieldCheck className="w-5 h-5" />
            </span>
            <div>
              <h2 className="login-panel__title">تسجيل الدخول</h2>
              <p className="login-panel__desc">أدخل بيانات حساب المدير للمتابعة إلى اللوحة.</p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-5" noValidate>
            {formError && <p id="login-form-error" className="field-error" role="alert" aria-live="assertive">{formError}</p>}
            <Field label="البريد الإلكتروني" htmlFor="login-email">
              <Input
                id="login-email" name="email" type="email" value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setValidationErrors((current) => ({ ...current, email: '' }));
                  setFormError('');
                }}
                aria-invalid={Boolean(validationErrors.email)}
                aria-describedby={validationErrors.email ? 'login-email-error' : undefined}
                placeholder="admin@example.com" required autoComplete="email"
              />
              {validationErrors.email && <p id="login-email-error" className="field-error" role="alert">{validationErrors.email}</p>}
            </Field>

            <Field label="كلمة المرور" htmlFor="login-password">
              <Input
                id="login-password" name="password" type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setValidationErrors((current) => ({ ...current, password: '' }));
                  setFormError('');
                }}
                aria-invalid={Boolean(validationErrors.password)}
                aria-describedby={validationErrors.password ? 'login-password-error' : undefined}
                placeholder="••••••••" required autoComplete="current-password"
                endAdornment={
                  <button
                    type="button"
                    className="field-adorn"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                }
              />
              {validationErrors.password && <p id="login-password-error" className="field-error" role="alert">{validationErrors.password}</p>}
            </Field>

            <Button type="submit" variant="primary" block size="lg" loading={loading} icon={!loading ? LogIn : null}>
              دخول
            </Button>
          </form>
        </div>

        <p className="text-center text-ink-secondary text-xs mt-8">
          كروتك برو — لوحة التحكم © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

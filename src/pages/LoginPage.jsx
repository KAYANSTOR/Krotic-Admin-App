import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { LogIn, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '../components/ui/Button';
import { Field, Input } from '../components/ui/Field';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success('تم تسجيل الدخول بنجاح');
      navigate('/');
    } catch (error) {
      console.error(error);
      if (error.message.includes('ليس مسجلاً كمدير')) {
        toast.error(error.message);
      } else if (error.code === 'permission-denied') {
        toast.error('قواعد Firestore تمنع قراءة مستند المدير. تأكد من أن Document ID يطابق UID للحساب.');
      } else if (error.code === 'auth/network-request-failed') {
        toast.error('تعذر الاتصال بخدمة Firebase. تحقق من الإنترنت ثم حاول مرة أخرى.');
      } else if (
        error.code === 'auth/invalid-credential' ||
        error.code === 'auth/wrong-password' ||
        error.code === 'auth/user-not-found'
      ) {
        toast.error('البريد الإلكتروني أو كلمة المرور غير صحيحة');
      } else if (error.code === 'auth/too-many-requests') {
        toast.error('محاولات كثيرة. الرجاء الانتظار قليلاً.');
      } else {
        toast.error('حدث خطأ أثناء تسجيل الدخول');
      }
    }
    setLoading(false);
  };

  return (
    <div className="login-screen">
      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-10">
          <div className="login-brand-mark">
            <img src="/icons/krotak-pro-192.png" alt="كروتك برو" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">كروتك برو</h1>
          <p className="text-stone-400 mt-2 text-sm">لوحة التحكم الإدارية</p>
        </div>

        <div className="login-panel">
          <h2 className="text-xl font-bold text-slate-900 mb-6 text-center">تسجيل الدخول</h2>

          <form onSubmit={handleLogin} className="space-y-5">
            <Field label="البريد الإلكتروني">
              <Input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com" required autoComplete="email"
              />
            </Field>

            <Field label="كلمة المرور">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password} onChange={(e) => setPassword(e.target.value)}
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
            </Field>

            <Button type="submit" variant="primary" block size="lg" loading={loading} icon={!loading ? LogIn : null}>
              دخول
            </Button>
          </form>
        </div>

        <p className="text-center text-stone-500 text-xs mt-8">
          كروتك برو — لوحة التحكم © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

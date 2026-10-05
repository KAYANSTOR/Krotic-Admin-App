import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { LogIn, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';

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
    <div className="login-screen min-h-screen bg-[#1F1F1F] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-10">
          <div className="login-brand-mark inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-5 shadow-brand overflow-hidden bg-white">
            <img src="/icons/krotak-pro-192.png" alt="كروتك برو" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">كروتك برو</h1>
          <p className="text-stone-400 mt-2 text-sm">لوحة التحكم الإدارية</p>
        </div>

        <div className="login-panel bg-white/95 backdrop-blur-xl rounded-3xl shadow-elevated p-8 border border-white/20">
          <h2 className="text-xl font-bold text-slate-900 mb-6 text-center">
            تسجيل الدخول
          </h2>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="label-field">البريد الإلكتروني</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                placeholder="admin@example.com"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="label-field">كلمة المرور</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field pl-11"
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary flex items-center justify-center gap-2 py-3.5 text-base"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <LogIn className="w-5 h-5" />
                  دخول
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-stone-500 text-xs mt-8">
          كروتك برو — لوحة التحكم © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

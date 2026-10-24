import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Archive,
  ArrowDownToLine,
  Bell,
  DollarSign,
  LayoutDashboard,
  Layers3,
  ListChecks,
  Plus,
  ScrollText,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { preloadRoute as requestRoutePreload } from '../lib/routeLoaders';
import useBodyScrollLock from '../lib/useBodyScrollLock';

const primaryItems = [
  { path: '/', label: 'الرئيسية', icon: LayoutDashboard },
  { path: '/users', label: 'الحسابات', icon: Users },
  { path: '/sales', label: 'التقارير', icon: DollarSign },
  { path: '/notifications', label: 'الإشعارات', icon: Bell },
];

const quickItems = [
  { path: '/template-center/inbound', label: 'قوالب التحويل الواردة', icon: ArrowDownToLine },
  { path: '/template-center/outbound', label: 'الرسائل الصادرة (SMS)', icon: Send },
  { path: '/template-center/wallets', label: 'المحافظ ومصادر الرسائل', icon: Wallet },
  { path: '/template-center/releases', label: 'الإصدارات والنشر', icon: Archive },
  { path: '/template-center/reconciliation', label: 'التسوية والعناصر القديمة', icon: ListChecks },
  { path: '/template-center', label: 'مركز القوالب والمحافظ', icon: Layers3 },
  { path: '/paid-features', label: 'مزايا الحساب', icon: Sparkles },
  { path: '/settings', label: 'الإعدادات العامة', icon: Settings },
  { path: '/admins', label: 'إدارة المدراء', icon: ShieldCheck },
  { path: '/audit', label: 'سجل العمليات', icon: ScrollText },
];

function preloadRoute(path) {
  requestRoutePreload(path).catch((error) => console.debug('Route preloading skipped:', error));
}

export default function BottomNav() {
  const [quickOpen, setQuickOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const quickSheetRef = useRef(null);
  const quickTriggerRef = useRef(null);

  useBodyScrollLock(quickOpen);

  useEffect(() => setQuickOpen(false), [location.pathname]);

  useEffect(() => {
    if (!quickOpen) return undefined;
    const previousActiveElement = document.activeElement;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setQuickOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    // Move focus into the dialog so the quick actions can be used with a keyboard.
    quickSheetRef.current?.querySelector('button')?.focus();
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      if (previousActiveElement instanceof HTMLElement && previousActiveElement.isConnected) {
        previousActiveElement.focus();
      }
    };
  }, [quickOpen]);

  const navigateTo = (path) => {
    setQuickOpen(false);
    preloadRoute(path);
    navigate(path);
  };

  return (
    <>
      {quickOpen && <div className="sheet-backdrop" onClick={() => setQuickOpen(false)} aria-hidden="true" />}
      {quickOpen && (
        <div ref={quickSheetRef} className="sheet sheet--quick is-open" role="dialog" aria-modal="true" aria-label="الإجراءات السريعة">
          <div className="sheet__grabber" aria-hidden="true" />
          <div className="sheet__head">
            <p className="sheet__title">الإجراءات السريعة</p>
            <button type="button" className="sheet__close" onClick={() => setQuickOpen(false)} aria-label="إغلاق الإجراءات">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="sheet__quick-grid">
            {quickItems.map(({ path, label, icon: Icon }) => (
              <button key={path} type="button" className="sheet__quick-item" onClick={() => navigateTo(path)}>
                <span className="sheet__link-icon"><Icon className="w-5 h-5" /></span>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <nav className="bottom-nav" aria-label="التنقل الرئيسي">
        <div className="bottom-nav-row">
          {primaryItems.slice(0, 2).map(({ path, label, icon: Icon }) => (
            <NavLink key={path} to={path} end={path === '/'} onPointerEnter={() => preloadRoute(path)} onPointerDown={() => preloadRoute(path)} onFocus={() => preloadRoute(path)} className={({ isActive }) => `bottom-nav-item ${isActive ? 'is-active' : ''}`} title={label}>
              <Icon className="bottom-nav-icon" aria-hidden="true" />
              <span className="bottom-nav-label">{label}</span>
            </NavLink>
          ))}
          <button ref={quickTriggerRef} type="button" className={`bottom-nav-quick ${quickOpen ? 'is-active' : ''}`} onClick={() => setQuickOpen((open) => !open)} aria-expanded={quickOpen} aria-haspopup="dialog" aria-label="الإجراءات السريعة">
            <span className="bottom-nav-quick__icon"><Plus className="w-8 h-8" strokeWidth={2.6} /></span>
            <span className="bottom-nav-label">الإجراءات</span>
          </button>
          {primaryItems.slice(2).map(({ path, label, icon: Icon }) => (
            <NavLink key={path} to={path} end={path === '/'} onPointerEnter={() => preloadRoute(path)} onPointerDown={() => preloadRoute(path)} onFocus={() => preloadRoute(path)} className={({ isActive }) => `bottom-nav-item ${isActive ? 'is-active' : ''}`} title={label}>
              <Icon className="bottom-nav-icon" aria-hidden="true" />
              <span className="bottom-nav-label">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}

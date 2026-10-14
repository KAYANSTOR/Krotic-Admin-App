import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Bell,
  CheckCircle2,
  DollarSign,
  LayoutDashboard,
  MoreHorizontal,
  Plus,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { preloadRoute as requestRoutePreload } from '../lib/routeLoaders';

const primaryItems = [
  { path: '/', label: 'الرئيسية', icon: LayoutDashboard },
  { path: '/users', label: 'المستخدمون', icon: Users },
  { path: '/sales', label: 'المبيعات', icon: DollarSign },
  { path: '/notifications', label: 'الإشعارات', icon: Bell },
];

const moreItems = [
  { path: '/settings', label: 'الإعدادات العامة', icon: Settings },
  { path: '/admins', label: 'إدارة المدراء', icon: ShieldCheck },
  { path: '/audit', label: 'سجل العمليات', icon: ScrollText },
];

const quickItems = [
  { path: '/sales', label: 'اعتماد تسوية العمولة', icon: CheckCircle2 },
  { path: '/notifications', label: 'إنشاء إشعار', icon: Bell },
  { path: '/users', label: 'إدارة المشتركين', icon: Users },
  { path: '/settings', label: 'إعدادات التطبيق', icon: Settings },
];

function preloadRoute(path) {
  requestRoutePreload(path).catch((error) => console.debug('Route preloading skipped:', error));
}

export default function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setMoreOpen(false);
    setQuickOpen(false);
  }, [location.pathname]);

  const isMoreActive = moreItems.some((item) => item.path === location.pathname);
  const navigateTo = (path) => {
    preloadRoute(path);
    navigate(path);
  };

  return (
    <>
      {(moreOpen || quickOpen) && (
        <div
          className="sheet-backdrop"
          onClick={() => { setMoreOpen(false); setQuickOpen(false); }}
          aria-hidden="true"
        />
      )}

      {quickOpen && (
        <div className="sheet sheet--quick" role="dialog" aria-modal="true" aria-label="الإجراءات السريعة">
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

      {moreOpen && (
        <div className="sheet sheet--more" role="dialog" aria-modal="true" aria-label="المزيد من الأقسام">
          <div className="sheet__grabber" aria-hidden="true" />
          <div className="sheet__head">
            <p className="sheet__title">أقسام أخرى</p>
            <button type="button" className="sheet__close" onClick={() => setMoreOpen(false)} aria-label="إغلاق القائمة">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="sheet__list">
            {moreItems.map(({ path, label, icon: Icon }) => (
              <NavLink key={path} to={path} onPointerDown={() => preloadRoute(path)} className={({ isActive }) => `sheet__link ${isActive ? 'is-active' : ''}`}>
                <span className="sheet__link-icon"><Icon className="w-5 h-5" /></span>
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      )}

      <nav className="bottom-nav" aria-label="التنقل الرئيسي">
        <div className="bottom-nav-row">
          {primaryItems.slice(0, 2).map(({ path, label, icon: Icon }) => (
            <NavLink key={path} to={path} end={path === '/'} onPointerEnter={() => preloadRoute(path)} className={({ isActive }) => `bottom-nav-item ${isActive ? 'is-active' : ''}`} title={label}>
              <Icon className="bottom-nav-icon" aria-hidden="true" />
              <span className="bottom-nav-label">{label}</span>
            </NavLink>
          ))}
          <button type="button" className={`bottom-nav-quick ${quickOpen ? 'is-active' : ''}`} onClick={() => { setQuickOpen((open) => !open); setMoreOpen(false); }} aria-expanded={quickOpen} aria-label="الإجراءات السريعة">
            <span className="bottom-nav-quick__icon"><Plus className="w-6 h-6" /></span>
            <span className="bottom-nav-label">إجراءات</span>
          </button>
          {primaryItems.slice(2).map(({ path, label, icon: Icon }) => (
            <NavLink key={path} to={path} end={path === '/'} onPointerEnter={() => preloadRoute(path)} className={({ isActive }) => `bottom-nav-item ${isActive ? 'is-active' : ''}`} title={label}>
              <Icon className="bottom-nav-icon" aria-hidden="true" />
              <span className="bottom-nav-label">{label}</span>
            </NavLink>
          ))}
          <button type="button" onClick={() => { setMoreOpen((open) => !open); setQuickOpen(false); }} className={`bottom-nav-item ${isMoreActive || moreOpen ? 'is-active' : ''}`} aria-expanded={moreOpen} aria-haspopup="dialog" title="المزيد">
            <MoreHorizontal className="bottom-nav-icon" aria-hidden="true" />
            <span className="bottom-nav-label">المزيد</span>
          </button>
        </div>
      </nav>
    </>
  );
}

import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Bell,
  DollarSign,
  LayoutDashboard,
  MoreHorizontal,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { preloadRoute as requestRoutePreload } from '../lib/routeLoaders';

/** العناصر اليومية تظهر مباشرة؛ الباقي داخل لوحة «المزيد». */
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

function preloadRoute(path) {
  requestRoutePreload(path).catch((error) => console.debug('Route preloading skipped:', error));
}

export default function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();

  // إغلاق لوحة «المزيد» تلقائياً عند التنقل.
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);

  const isMoreActive = moreItems.some((item) => item.path === location.pathname);

  return (
    <>
      {moreOpen && (
        <div className="sheet-backdrop" onClick={() => setMoreOpen(false)} aria-hidden="true" />
      )}
      <div
        className={`sheet sheet--more ${moreOpen ? 'is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="المزيد من الأقسام"
        aria-hidden={!moreOpen}
      >
        <div className="sheet__grabber" aria-hidden="true" />
        <div className="sheet__head">
          <p className="sheet__title">أقسام أخرى</p>
          <button type="button" className="sheet__close" onClick={() => setMoreOpen(false)} aria-label="إغلاق القائمة">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="sheet__list">
          {moreItems.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              onClick={() => setMoreOpen(false)}
              onPointerDown={() => preloadRoute(path)}
              className={({ isActive }) => `sheet__link ${isActive ? 'is-active' : ''}`}
            >
              <span className="sheet__link-icon"><Icon className="w-5 h-5" aria-hidden="true" /></span>
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </div>

      <nav className="bottom-nav lg:hidden" aria-label="التنقل الرئيسي">
        <div className="bottom-nav-row">
          {primaryItems.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              onPointerDown={() => preloadRoute(path)}
              onPointerEnter={() => preloadRoute(path)}
              onFocus={() => preloadRoute(path)}
              className={({ isActive }) => `bottom-nav-item ${isActive ? 'is-active' : ''}`}
              title={label}
            >
              <Icon className="bottom-nav-icon" aria-hidden="true" />
              <span className="bottom-nav-label">{label}</span>
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            className={`bottom-nav-item ${isMoreActive || moreOpen ? 'is-active' : ''}`}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            title="المزيد"
          >
            <MoreHorizontal className="bottom-nav-icon" aria-hidden="true" />
            <span className="bottom-nav-label">المزيد</span>
          </button>
        </div>
      </nav>
    </>
  );
}

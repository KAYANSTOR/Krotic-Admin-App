import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Settings, Users, DollarSign, Bell, ShieldCheck, ScrollText, X,
} from 'lucide-react';
import { loadRoute } from '../lib/routeLoaders';

/** أقسام النظام الفعلية، مرتّبة حسب أولوية الاستخدام اليومي. */
const navGroups = [
  {
    label: 'نظرة عامة',
    items: [{ path: '/', label: 'الرئيسية', icon: LayoutDashboard }],
  },
  {
    label: 'العمليات',
    items: [
      { path: '/users', label: 'إدارة المستخدمين', icon: Users },
      { path: '/sales', label: 'المبيعات والعمولات', icon: DollarSign },
      { path: '/notifications', label: 'الإشعارات', icon: Bell },
    ],
  },
  {
    label: 'النظام',
    items: [
      { path: '/settings', label: 'الإعدادات العامة', icon: Settings },
      { path: '/admins', label: 'إدارة المدراء', icon: ShieldCheck },
      { path: '/audit', label: 'سجل العمليات', icon: ScrollText },
    ],
  },
];

function preloadRoute(path) {
  loadRoute(path).catch((error) => console.debug('Route preloading skipped:', error));
}

export default function Sidebar({ isOpen, onClose }) {
  const location = useLocation();

  return (
    <>
      {isOpen && (
        <div className="sidebar-backdrop lg:hidden" onClick={onClose} aria-hidden="true" />
      )}

      <aside className={`sidebar ${isOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar__brand">
          <span className="sidebar__logo">
            <img src="/icons/krotak-pro-192.png" alt="كروتك برو" className="w-full h-full object-cover" loading="lazy" decoding="async" />
          </span>
          <div>
            <p className="sidebar__title">كروتك برو</p>
            <p className="sidebar__subtitle">لوحة التحكم</p>
          </div>
          <button type="button" onClick={onClose} className="sidebar__close lg:hidden" aria-label="إغلاق القائمة">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="sidebar__nav" aria-label="التنقل الرئيسي">
          {navGroups.map((group) => (
            <div className="sidebar__group" key={group.label}>
              <p className="sidebar__group-label">{group.label}</p>
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === '/'}
                    onClick={onClose}
                    onPointerEnter={() => preloadRoute(item.path)}
                    onFocus={() => preloadRoute(item.path)}
                    className={`sidebar__link ${isActive ? 'is-active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon className="sidebar__link-icon" aria-hidden="true" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          <p>كروتك برو Admin v1.0</p>
        </div>
      </aside>
    </>
  );
}

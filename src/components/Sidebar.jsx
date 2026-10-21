import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Settings, Users, DollarSign, Bell, ShieldCheck, ScrollText, X, Layers3,
  ArrowDownToLine, Send, Wallet, Archive, ListChecks,
} from 'lucide-react';
import { preloadRoute as requestRoutePreload } from '../lib/routeLoaders';

/** أقسام النظام الفعلية، مرتّبة حسب أولوية الاستخدام اليومي مع شاشات مخصصة لكل وظيفة. */
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
    label: 'القوالب والرسائل والنشر',
    items: [
      { path: '/template-center/inbound', label: 'قوالب التحويل الواردة', icon: ArrowDownToLine },
      { path: '/template-center/outbound', label: 'الرسائل الصادرة (SMS)', icon: Send },
      { path: '/template-center/wallets', label: 'المحافظ ومصادر الرسائل', icon: Wallet },
      { path: '/template-center/releases', label: 'الإصدارات والنشر', icon: Archive },
      { path: '/template-center/reconciliation', label: 'التسوية والعناصر القديمة', icon: ListChecks },
    ],
  },
  {
    label: 'النظام',
    items: [
      { path: '/settings', label: 'الإعدادات العامة', icon: Settings },
      { path: '/admins', label: 'إدارة المدراء', icon: ShieldCheck },
      { path: '/template-center', label: 'مركز القوالب الشامل', icon: Layers3 },
      { path: '/audit', label: 'سجل العمليات', icon: ScrollText },
    ],
  },
];

function preloadRoute(path) {
  requestRoutePreload(path).catch((error) => console.debug('Route preloading skipped:', error));
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
                const isActive = item.path === '/'
                  ? location.pathname === '/'
                  : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
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

import { NavLink } from 'react-router-dom';
import {
  Bell,
  DollarSign,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';

/** تسميات قصيرة لتظهر كل العناصر دفعة واحدة بدون تمرير أفقي. */
const navItems = [
  { path: '/', label: 'الرئيسية', icon: LayoutDashboard },
  { path: '/settings', label: 'الإعدادات', icon: Settings },
  { path: '/users', label: 'المستخدمين', icon: Users },
  { path: '/sales', label: 'المبيعات', icon: DollarSign },
  { path: '/notifications', label: 'الإشعارات', icon: Bell },
  { path: '/admins', label: 'المدراء', icon: ShieldCheck },
];

export default function BottomNav() {
  return (
    <nav className="bottom-nav lg:hidden" aria-label="التنقل الرئيسي">
      <div className="bottom-nav-row">
        {navItems.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            className={({ isActive }) => `bottom-nav-item ${isActive ? 'is-active' : ''}`}
            title={label}
          >
            <Icon className="bottom-nav-icon" aria-hidden="true" />
            <span className="bottom-nav-label">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

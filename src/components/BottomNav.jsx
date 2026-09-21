import { NavLink } from 'react-router-dom';
import {
  Bell,
  DollarSign,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';

const navItems = [
  { path: '/', label: 'الرئيسية', icon: LayoutDashboard },
  { path: '/settings', label: 'الإعدادات العامة', icon: Settings },
  { path: '/users', label: 'إدارة المستخدمين', icon: Users },
  { path: '/sales', label: 'المبيعات والعمولات', icon: DollarSign },
  { path: '/notifications', label: 'الإشعارات', icon: Bell },
  { path: '/admins', label: 'إدارة المدراء', icon: ShieldCheck },
];

export default function BottomNav() {
  return (
    <nav className="bottom-nav lg:hidden" aria-label="التنقل الرئيسي">
      <div className="bottom-nav-scroll">
        {navItems.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            className={({ isActive }) => `bottom-nav-item ${isActive ? 'is-active' : ''}`}
          >
            <Icon className="bottom-nav-icon" />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

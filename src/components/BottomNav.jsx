import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
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
import MeniscusSurface from './MeniscusSurface';

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
  const navRef = useRef(null);
  const surfaceRef = useRef(null);
  const dragIndexRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => { setMoreOpen(false); }, [location.pathname]);

  const isMoreActive = moreItems.some((item) => item.path === location.pathname);
  const activeIndex = isMoreActive ? 4 : Math.max(0, primaryItems.findIndex((item) => (
    item.path === location.pathname || (item.path === '/' && location.pathname === '/')
  )));
  const positionFromPointer = (event) => {
    const element = navRef.current;
    if (!element) return 0;
    const rect = element.getBoundingClientRect();
    // The project is RTL, so the first tab is on the right.
    const fromRight = rect.right - event.clientX;
    return Math.max(0, Math.min(4, (fromRight / rect.width) * 5 - 0.5));
  };

  const indexFromPointer = (event) => Math.max(0, Math.min(4, Math.floor(positionFromPointer(event))));

  useEffect(() => {
    surfaceRef.current?.setTarget(activeIndex, true);
  }, [activeIndex]);

  const updateDragPosition = (event) => {
    const position = positionFromPointer(event);
    dragIndexRef.current = Math.floor(position);
    surfaceRef.current?.setTarget(position);
  };

  const selectIndex = (index) => {
    dragIndexRef.current = null;
    surfaceRef.current?.setTarget(index);
    if (index === 4) {
      setMoreOpen((open) => !open);
      return;
    }
    const item = primaryItems[index];
    if (item) navigate(item.path);
  };

  const handlePointerDown = (event) => {
    if (event.target.closest('a, button')) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateDragPosition(event);
  };

  const handlePointerMove = (event) => {
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
    updateDragPosition(event);
  };

  const handlePointerUp = (event) => {
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
    const index = indexFromPointer(event);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    selectIndex(index);
  };

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

      <nav
        ref={navRef}
        className="bottom-nav bottom-nav--meniscus lg:hidden"
        aria-label="التنقل الرئيسي"
        style={{ '--meniscus-index': activeIndex }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          dragIndexRef.current = null;
          surfaceRef.current?.setTarget(activeIndex);
        }}
      >
        <MeniscusSurface ref={surfaceRef} position={activeIndex} />
        <div className="bottom-nav-row">
          {primaryItems.map(({ path, label, icon: Icon }, index) => (
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
              {index === activeIndex && <span className="sr-only">القسم الحالي</span>}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => selectIndex(4)}
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

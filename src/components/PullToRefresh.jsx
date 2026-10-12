import { useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';

const THRESHOLD = 68;
const MAX_PULL = 96;

/**
 * تحديث بالسحب للأسفل — يعمل على الأجهزة اللمسية فقط ولا يؤثر على سطح المكتب.
 * يلتقط السحب فقط عندما يكون المستخدم في أعلى الصفحة (scrollY === 0).
 */
export default function PullToRefresh({ onRefresh, disabled = false, children }) {
  const containerRef = useRef(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || disabled) return undefined;
    if (!window.matchMedia || !window.matchMedia('(pointer: coarse)').matches) return undefined;

    let startY = 0;
    let tracking = false;
    let pulling = 0;

    const onTouchStart = (event) => {
      if (refreshingRef.current || window.scrollY > 0) return;
      startY = event.touches[0].clientY;
      tracking = true;
    };

    const onTouchMove = (event) => {
      if (!tracking || refreshingRef.current) return;
      if (window.scrollY > 0) { tracking = false; pulling = 0; setPull(0); return; }
      const delta = event.touches[0].clientY - startY;
      if (delta <= 0) { pulling = 0; setPull(0); return; }
      if (event.cancelable) event.preventDefault();
      pulling = Math.min(delta * 0.5, MAX_PULL);
      pullRef.current = pulling;
      setPull(pulling);
    };

    const onTouchEnd = async () => {
      if (!tracking) return;
      tracking = false;
      const shouldRefresh = pullRef.current >= THRESHOLD;
      pulling = 0;
      setPull(0);
      if (!shouldRefresh || refreshingRef.current) return;
      refreshingRef.current = true;
      setRefreshing(true);
      try {
        await onRefreshRef.current?.();
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [disabled]);

  const active = pull > 0;
  const armed = pull >= THRESHOLD;

  return (
    <div className="ptr" ref={containerRef} style={{ '--ptr-pull': `${pull}px` }}>
      <div className={`ptr__indicator ${active || refreshing ? 'is-visible' : ''} ${armed ? 'is-armed' : ''} ${refreshing ? 'is-refreshing' : ''}`} aria-hidden="true">
        <span className="ptr__spinner">
          <ArrowDown className="w-4 h-4" />
        </span>
      </div>
      <div className="ptr__content" style={{ transform: pull ? `translateY(${pull * 0.6}px)` : undefined }}>
        {children}
      </div>
    </div>
  );
}

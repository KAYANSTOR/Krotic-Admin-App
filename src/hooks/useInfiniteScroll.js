import { useEffect, useRef } from 'react';

/**
 * تحميل تلقائي عند وصول المستخدم لأسفل القائمة.
 * بديل زر "عرض المزيد".
 */
export default function useInfiniteScroll({ onLoadMore, hasMore, disabled = false }) {
  const sentinelRef = useRef(null);

  useEffect(() => {
    if (!hasMore || disabled) return undefined;
    const node = sentinelRef.current;
    if (!node) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) onLoadMore();
      },
      { rootMargin: '300px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, disabled, onLoadMore]);

  return sentinelRef;
}

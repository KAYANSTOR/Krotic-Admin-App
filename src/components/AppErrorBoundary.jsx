import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * حدود أخطاء React على مستوى التطبيق.
 * لا تعتمد على CSS خارجي — كل شيء inline بـ var(--ui-*) لتعمل حتى لو
 * فشل تحميل stylesheet رئيسي.
 */
export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // eslint-disable-next-line no-console
    console.error('AppErrorBoundary caught an error:', error, errorInfo);
    if (typeof this.props.onError === 'function') {
      try { this.props.onError(error, errorInfo); } catch { /* noop */ }
    }
  }

  handleReload = () => window.location.reload();
  handleGoHome = () => { window.location.href = '/'; };

  render() {
    if (!this.state.hasError) return this.props.children;

    const message = this.state.error?.message || String(this.state.error || 'خطأ غير معروف');

    return (
      <main
        dir="rtl"
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '2rem',
          background: 'var(--ui-paper, #F7F4EF)',
          color: 'var(--ui-ink, #1A1410)',
          fontFamily: 'Tajawal, system-ui, sans-serif',
        }}
      >
        <section
          style={{
            maxWidth: 520,
            width: '100%',
            textAlign: 'center',
            background: 'var(--ui-surface, #FFFFFF)',
            border: '1px solid var(--ui-line, #E5DDD2)',
            borderRadius: 20,
            padding: '2rem',
            boxShadow: '0 12px 32px -16px rgba(26,20,16,.18)',
          }}
        >
          <span
            style={{
              display: 'inline-grid',
              placeItems: 'center',
              width: 56,
              height: 56,
              borderRadius: 16,
              background: 'var(--ui-danger-soft, #FBECEC)',
              color: 'var(--ui-danger-ink, #8A2B2B)',
              marginBottom: 16,
            }}
            aria-hidden="true"
          >
            <AlertTriangle size={24} />
          </span>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>
            تعذر عرض الصفحة
          </h1>
          <p style={{ marginTop: 12, lineHeight: 1.8, color: 'var(--ui-muted, #7A6B5F)', fontSize: 14 }}>
            حدث خطأ مؤقت أثناء تشغيل الصفحة. جرّب إعادة التحميل، وإذا استمر الخطأ
            امسح بيانات الموقع من إعدادات المتصفح ثم حاول مرة أخرى.
          </p>
          {message && (
            <code
              dir="ltr"
              style={{
                display: 'block',
                marginTop: 16,
                padding: 12,
                fontSize: 12,
                textAlign: 'left',
                color: 'var(--ui-danger-ink, #8A2B2B)',
                background: 'var(--ui-danger-soft, #FBECEC)',
                borderRadius: 10,
                overflowWrap: 'anywhere',
              }}
            >
              {message}
            </code>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                minHeight: 44, padding: '0 20px', border: 0, borderRadius: 10,
                background: 'var(--ui-brand, #D97757)', color: '#FFFFFF',
                fontWeight: 700, fontSize: 14, cursor: 'pointer',
              }}
            >
              <RefreshCw size={16} /> إعادة التحميل
            </button>
            <button
              type="button"
              onClick={this.handleGoHome}
              style={{
                display: 'inline-flex', alignItems: 'center',
                minHeight: 44, padding: '0 20px',
                border: '1px solid var(--ui-line, #E5DDD2)', borderRadius: 10,
                background: 'transparent', color: 'var(--ui-ink-soft, #4A3D34)',
                fontWeight: 700, fontSize: 14, cursor: 'pointer',
              }}
            >
              العودة للرئيسية
            </button>
          </div>
        </section>
      </main>
    );
  }
}

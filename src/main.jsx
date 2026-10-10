import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, errorMessage: error?.message || String(error || '') };
  }

  componentDidCatch(error) {
    console.error('واجهة التطبيق توقفت بسبب خطأ:', error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main dir="rtl" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem', background: '#211b1a', color: '#fff' }}>
        <section style={{ maxWidth: 520, width: '100%', textAlign: 'center', background: '#fff', color: '#241c1a', borderRadius: 20, padding: '2rem', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
          <h1 style={{ margin: 0, fontSize: '1.25rem' }}>تعذر عرض لوحة التحكم</h1>
          <p style={{ lineHeight: 1.8, color: '#6b625e' }}>حدث خطأ مؤقت في تشغيل الصفحة. أعد تحميل الموقع، وإذا استمر الخطأ امسح بيانات الموقع ثم حاول مرة أخرى.</p>
          {this.state.errorMessage ? <code dir="ltr" style={{ display: 'block', margin: '1rem 0', padding: '.75rem', overflowWrap: 'anywhere', textAlign: 'left', fontSize: '.75rem', color: '#8b3a20', background: '#fff3ed', borderRadius: 8 }}>{this.state.errorMessage}</code> : null}
          <button type="button" onClick={() => window.location.reload()} style={{ border: 0, borderRadius: 10, padding: '.75rem 1.5rem', background: '#c9652b', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>إعادة تحميل الصفحة</button>
        </section>
      </main>
    );
  }
}

// PWA: تسجيل الـ service worker مع تحديث تلقائي عند توفّر إصدار جديد.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').then((registration) => {
      // عند تفعيل إصدار جديد يستبدل القديم، نُعيد التحميل مرة واحدة فقط.
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
      });

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // وجود controller يعني أن هناك نسخة تعمل الآن، أي أن هذا تحديث وليس أول تثبيت.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            installing.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    }).catch((error) => {
      console.error('Service worker registration failed:', error);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);

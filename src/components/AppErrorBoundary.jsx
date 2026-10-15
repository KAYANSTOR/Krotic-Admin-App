import { Component } from 'react';
import { RefreshCw } from 'lucide-react';
import Button from './ui/Button';

export default class AppErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[v0] Admin screen crashed safely:', error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="app-error" role="alert" dir="rtl">
        <div className="app-error__card">
          <span className="icon-tile icon-tile--danger icon-tile--lg" aria-hidden="true">
            <RefreshCw />
          </span>
          <h1 className="app-error__title">تعذر عرض هذه الصفحة</h1>
          <p className="app-error__message">حدث خطأ غير متوقع، لكن بياناتك لم تتأثر. أعد المحاولة أو ارجع إلى الرئيسية.</p>
          <div className="app-error__actions">
            <Button type="button" variant="primary" icon={RefreshCw} onClick={this.handleRetry}>إعادة المحاولة</Button>
            <Button type="button" variant="secondary" onClick={() => { window.location.assign('/'); }}>الرئيسية</Button>
          </div>
        </div>
      </main>
    );
  }
}

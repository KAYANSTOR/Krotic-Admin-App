import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, Wallet, Users, Eye, EyeOff, UserPlus, CreditCard, Bell, Layers3,
} from 'lucide-react';
import { formatNumber } from '../../lib/format.js';

export default function DashSummary({ stats, balanceVisible, onToggleBalance }) {
  const totalSales = Number(stats?.totalSales) || 0;
  const outstanding = Number(stats?.totalCommissionOutstanding) || 0;
  const totalUsers = Number(stats?.totalUsers) || 0;
  const [visibilityAnnouncement, setVisibilityAnnouncement] = useState('');

  const toggleBalance = () => {
    setVisibilityAnnouncement(balanceVisible ? 'تم إخفاء إجمالي المبيعات' : 'تم إظهار إجمالي المبيعات');
    onToggleBalance();
  };

  return (
    <section className="dash-summary" aria-label="الملخص المالي">
      <article className="dash-summary__hero">
        <header className="dash-summary__head">
          <span className="dash-summary__label" title="إجمالي المبيعات المكتملة لجميع الفترات">إجمالي المبيعات</span>
          <span className="dash-summary__badge">
            <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
            كل الوقت
          </span>
        </header>

        <p className="dash-summary__value">
          <strong aria-live="polite">
            {balanceVisible ? formatNumber(totalSales) : '••••••'}
          </strong>
          <button
            type="button"
            className="dash-summary__visibility -m-2 p-2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center"
            onClick={toggleBalance}
            aria-label={balanceVisible ? 'إخفاء إجمالي المبيعات' : 'إظهار إجمالي المبيعات'}
            aria-pressed={!balanceVisible}
            title={balanceVisible ? 'إخفاء إجمالي المبيعات' : 'إظهار إجمالي المبيعات'}
          >
            {balanceVisible
              ? <Eye className="w-5 h-5" aria-hidden="true" />
              : <EyeOff className="w-5 h-5" aria-hidden="true" />}
          </button>
          <span>ريال يمني</span>
        </p>
        <p className="sr-only" role="status" aria-live="polite">{visibilityAnnouncement}</p>

        <p className="dash-summary__hint">
          يحتسب المبيعات المكتملة فقط، وتتحدث المبيعات والعمولة المتبقية مع سجل البيع نفسه.
        </p>

        <dl className="dash-summary__meta">
          <div className="dash-summary__meta-item">
            <dt><Wallet className="w-4 h-4" aria-hidden="true" /> عمولة الإدارة غير المسوّاة</dt>
            <dd>{formatNumber(outstanding)} <small>ريال يمني</small></dd>
          </div>
          <div className="dash-summary__meta-item">
            <dt><Users className="w-4 h-4" aria-hidden="true" /> عدد الشبكات</dt>
            <dd>{formatNumber(totalUsers)} <small>شبكة</small></dd>
          </div>
        </dl>

        <nav className="dash-quick" aria-label="إجراءات سريعة">
          <Link to="/users" className="dash-quick__item dash-quick__item--primary min-h-[44px]">
            <span className="dash-quick__icon"><UserPlus aria-hidden="true" /></span>
            <span className="dash-quick__label">إدارة المستخدمين</span>
          </Link>
          <Link to="/sales" className="dash-quick__item min-h-[44px]">
            <span className="dash-quick__icon"><CreditCard aria-hidden="true" /></span>
            <span className="dash-quick__label">المبيعات والعمولات</span>
          </Link>
          <Link to="/notifications" className="dash-quick__item min-h-[44px]">
            <span className="dash-quick__icon"><Bell aria-hidden="true" /></span>
            <span className="dash-quick__label">إرسال إشعار</span>
          </Link>
          <Link to="/template-center" className="dash-quick__item min-h-[44px]">
            <span className="dash-quick__icon"><Layers3 aria-hidden="true" /></span>
            <span className="dash-quick__label">مركز القوالب</span>
          </Link>
        </nav>
      </article>
    </section>
  );
}

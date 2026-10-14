import { cn } from '../../lib/cn';

/**
 * ترويسة الصفحة المعتمدة، مطابقة تمامًا لترويسة الشاشة الرئيسية (dash-hello)
 * لتكون هي المرجع الوحيد للتقسيم: kicker + عنوان + وصف + إجراءات (تحديث البيانات).
 */
export default function PageHero({ icon: Icon, kicker = 'لوحة الإدارة', title, subtitle, meta, actions, className }) {
  return (
    <section className={cn('dash-hello', className)} aria-label={title}>
      <div className="dash-hello__main">
        <span className="dash-hello__kicker">
          {Icon ? <Icon className="w-4 h-4" aria-hidden="true" /> : null}
          {kicker}
        </span>
        <h1 className="dash-hello__title">{title}</h1>
        {subtitle ? <p className="dash-hello__sub">{subtitle}</p> : null}
        {meta ? <p className="page-header__meta">{meta}</p> : null}
      </div>
      {actions}
    </section>
  );
}

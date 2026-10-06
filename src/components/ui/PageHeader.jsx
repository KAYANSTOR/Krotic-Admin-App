import { cn } from '../../lib/cn';

export default function PageHeader({ icon: Icon, title, description, meta, actions, className }) {
  return (
    <div className={cn('page-header', className)}>
      <div className="page-header__main">
        {Icon && <span className="page-header__icon icon-tile icon-tile--brand icon-tile--lg"><Icon className="w-5 h-5" aria-hidden="true" /></span>}
        <div>
          <h1 className="page-title">{title}</h1>
          {description && <p className="page-header__desc">{description}</p>}
          {meta && <p className="page-header__meta">{meta}</p>}
        </div>
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </div>
  );
}

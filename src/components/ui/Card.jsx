import { cn } from '../../lib/cn';

export function Card({ as: Component = 'div', flush = false, className, children, ...rest }) {
  return (
    <Component className={cn('card', flush && 'card--flush', className)} {...rest}>
      {children}
    </Component>
  );
}

export function CardHeader({ title, icon: Icon, description, action, className }) {
  return (
    <div className={cn('card-header', className)}>
      <div className="card-header__main">
        {Icon ? <span className="card-header__icon icon-tile icon-tile--brand icon-tile--sm"><Icon className="w-4 h-4" aria-hidden="true" /></span> : null}
        <div>
          <h3 className="card-header__title">{title}</h3>
          {description ? <p className="card-header__desc">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="card-header__action">{action}</div> : null}
    </div>
  );
}

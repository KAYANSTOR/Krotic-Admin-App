import { cn } from '../../lib/cn';

/**
 * Consistent visual division for dashboard screens: an eyebrow + title + optional
 * description and trailing action, wrapping a group of related cards/content.
 */
export default function Section({ eyebrow, title, description, action, className, children, ...rest }) {
  return (
    <section className={cn('section', className)} {...rest}>
      {(eyebrow || title || action) && (
        <header className="section__head">
          <div className="min-w-0">
            {eyebrow && <span className="section__eyebrow">{eyebrow}</span>}
            {title && <h2 className="section__title">{title}</h2>}
            {description && <p className="section__desc">{description}</p>}
          </div>
          {action && <div className="section__action">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

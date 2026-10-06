export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="empty-state">
      {Icon && <span className="icon-tile icon-tile--neutral icon-tile--lg"><Icon className="w-5 h-5" aria-hidden="true" /></span>}
      <p className="empty-state__title">{title}</p>
      {description && <p className="empty-state__desc">{description}</p>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}

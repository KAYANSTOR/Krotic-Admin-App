import { cn } from '../../lib/cn';

export function Field({ label, hint, htmlFor, required, className, children }) {
  return (
    <div className={cn('field', className)}>
      {label && (
        <label className="label-field" htmlFor={htmlFor}>
          {label}
          {required && <span aria-hidden="true"> *</span>}
        </label>
      )}
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function Input({ icon: Icon, endAdornment, className, ...rest }) {
  return (
    <div className="field-control">
      {Icon && <Icon className="field-affix field-affix--lead w-4 h-4" aria-hidden="true" />}
      <input
        className={cn('input-field', Icon && 'input-field--lead', endAdornment && 'input-field--trail', className)}
        {...rest}
      />
      {endAdornment}
    </div>
  );
}

export function Textarea({ className, ...rest }) {
  return <textarea className={cn('input-field', className)} {...rest} />;
}

export function Select({ className, children, ...rest }) {
  return (
    <select className={cn('input-field', className)} {...rest}>
      {children}
    </select>
  );
}

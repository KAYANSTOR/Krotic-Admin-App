import { cn } from '../../lib/cn';

export default function Toolbar({ className, children }) {
  return <div className={cn('toolbar', className)}>{children}</div>;
}

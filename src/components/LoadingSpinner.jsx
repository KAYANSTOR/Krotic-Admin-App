export default function LoadingSpinner({ size = 'md', text = 'جاري التحميل...' }) {
  const sizeClasses = {
    sm: 'w-5 h-5',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div
        className={`${sizeClasses[size]} border-4 border-line-strong border-t-primary-600 rounded-full animate-spin`}
      />
      {text && <p className="mt-4 text-ink-secondary text-sm">{text}</p>}
    </div>
  );
}

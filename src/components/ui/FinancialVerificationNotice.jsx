export default function FinancialVerificationNotice({ className = '' }) {
  return (
    <div
      className={`rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 ${className}`}
      role="alert"
    >
      سجلات المبيعات الحالية يرسلها التطبيق مباشرة. حقول الحالة والعمولة والصافي الواردة من Android ليست
      دليلاً موثوقاً على البيع أو التسوية؛ لا يوجد بعد ACK خادمي للتحقق أو API تسوية معتمد. الأرقام المعروضة
      للتشغيل فقط وغير صالحة ككشف نهائي حتى اعتماد المصدر والسياسة المالية.
    </div>
  );
}

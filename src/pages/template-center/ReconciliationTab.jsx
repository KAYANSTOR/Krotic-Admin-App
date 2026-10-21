import { AlertTriangle, Database, HelpCircle, ListChecks, Upload } from 'lucide-react';
import Section from '../../components/ui/Section';
import { Card } from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import { useTemplateCenter } from './TemplateCenterContext';
import { reconcileLegacy } from '../../lib/templateCenterView';

/**
 * تبويب التسوية والعناصر القديمة.
 *
 * مبدأ صارم: لا نزرع ولا نكرّر أي عنصر تلقائيًا. نعرض فقط ما يمكن قراءته من
 * الإصدارات المركزية، ونعلن بوضوح أن العناصر الموجودة على أجهزة Android فقط
 * (سجل الهاتف المحلي) غير متاحة مركزيًا ولا يمكن عرضها أو تسويتها من اللوحة.
 */
export default function ReconciliationTab() {
  const { releases, networks } = useTemplateCenter();
  const report = reconcileLegacy({ releases, networks });

  return (
    <Section
      title="التسوية والعناصر القديمة"
      description="قراءة فقط. لا تُزرع العناصر القديمة ولا تُكرَّر تلقائيًا. المصدر المركزي هو الإصدارات المنشورة فقط."
    >
      <Card className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-700">
            <Database className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="font-bold text-stone-900">مصدر البيانات المتاح للتسوية</p>
            <p className="mt-1 text-sm leading-6 text-stone-700">
              الإصدارات المركزية المنشورة ({releases.length}) والشبكات ({networks.length}).
              لا تتوفر اللوحة على قراءة السجل المحلي لأجهزة Android.
            </p>
          </div>
        </div>

        <div className={`rounded-xl border p-4 ${report.known ? 'border-sky-200 bg-sky-50 text-sky-950' : 'border-amber-200 bg-amber-50 text-amber-950'}`} role="status">
          <div className="flex items-center gap-2 font-bold">
            {report.known ? <ListChecks className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
            {report.known ? 'تسوية مبنية على الإصدارات المركزية' : 'حالة العناصر القديمة غير معروفة'}
          </div>
          <p className="mt-2 text-sm leading-6">{report.summary}</p>
        </div>

        {report.known ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-right text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-stone-600">
                  <th className="px-3 py-3 font-bold">النوع</th>
                  <th className="px-3 py-3 font-bold">عدد المعرّفات في الإصدارات</th>
                  <th className="px-3 py-3 font-bold">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.kind} className="border-b border-stone-100 last:border-0">
                    <td className="px-3 py-3 font-semibold text-stone-800">{row.label}</td>
                    <td className="px-3 py-3 tabular-nums">{row.count}</td>
                    <td className="px-3 py-3"><Badge tone="info">من الإصدارات المركزية</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={HelpCircle}
            title="لا يمكن عرض العناصر القديمة"
            description="لا توجد إصدارات مركزية للقراءة، والسجل المحلي لأجهزة Android غير متاح مركزيًا. لن تُزرع أي عناصر تلقائيًا."
          />
        )}

        <div className="rounded-xl bg-stone-50 p-4 text-sm leading-6 text-stone-700">
          <p className="flex items-center gap-2 font-bold text-stone-900">
            <Upload className="h-4 w-4" aria-hidden="true" /> كيف تُدار العناصر القديمة؟
          </p>
          <ul className="mt-2 list-disc space-y-1 ps-5">
            <li>الاستيراد يتم يدويًا فقط: استورد كتالوج زرع Android إلى المسودة، أو أدخل العناصر يدويًا، ثم احفظ وانشر إصدارًا.</li>
            <li>لا توجد مطابقة تلقائية بين سجل أجهزة Android واللوحة؛ هذا يحتاج عقد ACK وموافقة المالك.</li>
            <li>عنصر موجود على جهاز ولم يُنشر مركزيًا يبقى «غير معروف» ولا يُعدّ «مزروعًا».</li>
          </ul>
        </div>
      </Card>
    </Section>
  );
}

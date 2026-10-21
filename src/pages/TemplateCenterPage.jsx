import { Navigate, Route, Routes } from 'react-router-dom';
import { TemplateCenterProvider } from './template-center/TemplateCenterContext';
import TemplateCenterLayout from './template-center/TemplateCenterLayout';
import WalletsTab from './template-center/WalletsTab';
import InboundTab from './template-center/InboundTab';
import OutboundTab from './template-center/OutboundTab';
import ReleasesTab from './template-center/ReleasesTab';
import ReconciliationTab from './template-center/ReconciliationTab';

/**
 * مركز المحافظ والقوالب — غلاف يوفّر حالة مشتركة (المسودة/الإصدارات/الكتالوج)
 * ويوزّع التبويبات عبر مسارات فرعية واضحة:
 *   /template-center/wallets        المحافظ ومصادر الرسائل
 *   /template-center/inbound        قوالب التحويل الواردة
 *   /template-center/outbound       الرسائل الصادرة (SMS)
 *   /template-center/releases       الإصدارات والمؤشرات
 *   /template-center/reconciliation التسوية والعناصر القديمة
 */
export default function TemplateCenterPage() {
  return (
    <TemplateCenterProvider>
      <Routes>
        <Route element={<TemplateCenterLayout />}>
          <Route index element={<Navigate to="wallets" replace />} />
          <Route path="wallets" element={<WalletsTab />} />
          <Route path="inbound" element={<InboundTab />} />
          <Route path="outbound" element={<OutboundTab />} />
          <Route path="releases" element={<ReleasesTab />} />
          <Route path="reconciliation" element={<ReconciliationTab />} />
          <Route path="*" element={<Navigate to="wallets" replace />} />
        </Route>
      </Routes>
    </TemplateCenterProvider>
  );
}

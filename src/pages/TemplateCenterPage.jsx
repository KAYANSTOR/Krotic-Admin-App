import { Routes, Route, Navigate } from 'react-router-dom';
import { TemplateCenterProvider } from './template-center/TemplateCenterContext';
import TemplateCenterLayout from './template-center/TemplateCenterLayout';
import WalletsTab from './template-center/WalletsTab';
import InboundTab from './template-center/InboundTab';
import OutboundTab from './template-center/OutboundTab';
import ReleasesTab from './template-center/ReleasesTab';
import ReconciliationTab from './template-center/ReconciliationTab';

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

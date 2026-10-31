import { Link } from 'react-router-dom';
import {
  ArrowDownToLine, Send, Wallet, Archive, ListChecks, Settings,
} from 'lucide-react';
import IconTile from '../ui/IconTile.jsx';
import Section from '../ui/Section.jsx';

const SERVICES = [
  { to: '/template-center/inbound', Icon: ArrowDownToLine, tone: 'brand', label: 'قوالب الرسائل الواردة' },
  { to: '/template-center/outbound', Icon: Send, tone: 'brand', label: 'الرسائل الصادرة (SMS)' },
  { to: '/template-center/wallets', Icon: Wallet, tone: 'gold', label: 'مصادر الرسائل' },
  { to: '/template-center/releases', Icon: Archive, tone: 'neutral', label: 'الإصدارات والنشر' },
  { to: '/template-center/reconciliation', Icon: ListChecks, tone: 'neutral', label: 'التسوية والعناصر القديمة' },
  { to: '/settings', Icon: Settings, tone: 'neutral', label: 'الإعدادات العامة' },
];

export default function DashServices() {
  return (
    <Section
      className="dash-services-section"
      eyebrow="الوصول السريع"
      title="الخدمات والأقسام"
      aria-label="الخدمات والأقسام"
    >
      <div className="dash-services">
        {SERVICES.map(({ to, Icon, tone, label }) => (
          <Link key={to} to={to} className="dash-service min-h-[44px]">
            <IconTile icon={Icon} tone={tone} />
            <span className="dash-service__label">{label}</span>
          </Link>
        ))}
      </div>
    </Section>
  );
}

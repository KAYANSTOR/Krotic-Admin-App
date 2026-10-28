import Section from '../ui/Section';
import { Card } from '../ui/Card';
import Badge from '../ui/Badge';
import UserDevicesPanel from '../UserDevicesPanel';
import { formatDate } from '../../lib/format';
import { formatAppVersion } from '../../lib/users/profileHelpers';

export default function UserProfileDeviceSection({
  user, uid, targetName, globalConfig, status, expired, updateStatus, updateLabel,
}) {
  return (
          <Section eyebrow="التطبيق والجهاز" title="الإصدار المثبت وآخر ظهور">
            <Card>
              <dl className="user-card__meta" style={{ background: 'transparent', border: 0, padding: 0 }}>
                <div className="user-card__meta-item">
                  <dt>الإصدار المثبّت</dt>
                  <dd dir="ltr" className="font-mono">{formatAppVersion(user.app_version ?? user.appVersion)}</dd>
                </div>
                <div className="user-card__meta-item">
                  <dt>versionCode المثبّت</dt>
                  <dd dir="ltr" className="font-mono">{formatAppVersion(user.app_version_code)}</dd>
                </div>
                <div className="user-card__meta-item">
                  <dt>آخر إصدار منشور</dt>
                  <dd dir="ltr" className="font-mono">
                    {globalConfig?.app_latest_version || 'غير محدد'}
                    {globalConfig?.app_latest_version_code != null && globalConfig.app_latest_version_code !== ''
                      ? ` (${formatAppVersion(globalConfig.app_latest_version_code)})`
                      : ''}
                  </dd>
                </div>
                <div className="user-card__meta-item">
                  <dt>حالة التحديث</dt>
                  <dd>
                    <Badge tone={updateStatus === 'current' ? 'success' : updateStatus === 'outdated' ? 'warning' : 'neutral'}>
                      {updateLabel}
                    </Badge>
                  </dd>
                </div>
                <div className="user-card__meta-item">
                  <dt>آخر ظهور</dt>
                  <dd>{formatDate(user.last_seen_at || user.lastSeenAt, { withTime: true })}</dd>
                </div>
                <div className="user-card__meta-item">
                  <dt>المنصة</dt>
                  <dd>{user.platform || 'غير مُبلّغ'}</dd>
                </div>
                <div className="user-card__meta-item">
                  <dt>حالة الترخيص/الوصول</dt>
                  <dd>{status.text}{user.is_active === false ? ' — موقوف' : expired ? ' — منتهي' : ''}</dd>
                </div>
              </dl>
              <p className="text-xs text-muted mt-4">
                تعكس هذه البيانات آخر تقرير ناجح من التطبيق، وليست فحصاً لحظياً للجهاز.
              </p>
            </Card>
            <UserDevicesPanel userId={uid} userLabel={targetName} />
          </Section>
  );
}

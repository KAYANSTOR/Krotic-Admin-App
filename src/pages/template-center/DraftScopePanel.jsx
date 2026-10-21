import { Archive, Cloud, Package, Save, Trash2, AlertTriangle } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import { Field, Input, Select } from '../../components/ui/Field';
import { useTemplateCenter } from './TemplateCenterContext';

/**
 * لوحة مشتركة لإدارة المسودة والنطاق والنشر. تُستخدم في تبويبات المحتوى
 * (المحافظ/الوارد/الصادر) لأن المسودة الواحدة تحمل الأقسام الثلاثة معًا.
 *
 * الأزرار مفصولة صراحةً: تحميل إلى المسودة / حفظ مسودة / نشر إصدار / تراجع (في تبويب الإصدارات).
 */
export default function DraftScopePanel() {
  const {
    drafts, networks, activeDraftId, selectDraft, startNewDraft,
    title, setTitle, scopeType, setScopeType, networkId, setNetworkId,
    minAppVersion, setMinAppVersion, minAppBuild, setMinAppBuild,
    draftIsDirty, markDirty, currentPointer, saving, working,
    saveDraft, publish, deleteDraft, loadBundledPack,
  } = useTemplateCenter();

  return (
    <Card className="space-y-4 p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Field label="المسودة" htmlFor="draft-select">
          <Select
            id="draft-select"
            value={activeDraftId}
            onChange={(event) => {
              if (event.target.value === '') startNewDraft();
              else selectDraft(event.target.value);
            }}
          >
            <option value="">مسودة جديدة</option>
            {drafts.map((draft) => (
              <option key={draft.id} value={draft.id}>
                {draft.title || 'مسودة بلا عنوان'} · {draft.scope?.type === 'network' ? draft.scope.networkId : 'عام'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="عنوان المسودة" htmlFor="draft-title" required>
          <Input
            id="draft-title"
            value={title}
            onChange={(event) => { setTitle(event.target.value); markDirty(); }}
            maxLength={120}
            placeholder="مثال: قوالب التحويل — أكتوبر"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نطاق النشر" htmlFor="draft-scope">
          <Select
            id="draft-scope"
            value={scopeType}
            onChange={(event) => {
              setScopeType(event.target.value);
              if (event.target.value === 'global') setNetworkId('');
              markDirty();
            }}
          >
            <option value="global">عام لكل الشبكات</option>
            <option value="network">شبكة محددة</option>
          </Select>
        </Field>
        {scopeType === 'network' && (
          <Field label="الشبكة" htmlFor="draft-network" required>
            <Select
              id="draft-network"
              value={networkId}
              onChange={(event) => { setNetworkId(event.target.value); markDirty(); }}
              required
            >
              <option value="">اختر شبكة</option>
              {networks.map((network) => (
                <option key={network.id} value={network.id}>{network.name} · {network.id}</option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="أدنى إصدار Android متوافق" htmlFor="min-app-version" hint="صيغة x.y.z. اترك 0.0.0 للسماح لكل الإصدارات.">
          <Input
            id="min-app-version"
            value={minAppVersion}
            onChange={(event) => setMinAppVersion(event.target.value)}
            pattern="^\d+\.\d+\.\d+$"
            maxLength={32}
          />
        </Field>
        <Field label="أدنى versionCode متوافق" htmlFor="min-app-build">
          <Input
            id="min-app-build"
            type="number"
            min="0"
            max="2147483647"
            value={minAppBuild}
            onChange={(event) => setMinAppBuild(event.target.value)}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button icon={Save} loading={saving} onClick={saveDraft}>حفظ المسودة</Button>
        <Button
          variant="secondary"
          icon={Package}
          onClick={loadBundledPack}
          title="نسخ القيم المضمّنة في المصدر إلى المسودة (محليًا فقط)"
        >
          تحميل إلى المسودة
        </Button>
        <Button
          variant="success"
          icon={Cloud}
          loading={working}
          disabled={!activeDraftId || draftIsDirty || (scopeType === 'network' && !networkId)}
          onClick={publish}
        >
          نشر إصدار
        </Button>
        {activeDraftId && (
          <Button variant="danger" icon={Trash2} loading={working} onClick={deleteDraft}>حذف المسودة</Button>
        )}
        {draftIsDirty && (
          <Badge tone="warning">
            <AlertTriangle className="me-1 inline h-3.5 w-3.5" aria-hidden="true" />
            تغييرات غير محفوظة — احفظ قبل النشر
          </Badge>
        )}
        {currentPointer && (
          <Badge tone="success" dot>الإصدار النشط: {currentPointer.version || currentPointer.releaseId}</Badge>
        )}
      </div>

      <p className="flex items-start gap-2 rounded-xl bg-stone-50 p-3 text-xs leading-5 text-stone-600">
        <Archive className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        «تحميل إلى المسودة» ينسخ القيم المضمّنة في كود اللوحة إلى محرر المتصفح فقط. لا يُحفظ ولا يُنشر ولا يُرسل إلى أي جهاز حتى تضغط «حفظ المسودة» ثم «نشر إصدار».
      </p>
    </Card>
  );
}

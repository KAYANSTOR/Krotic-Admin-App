import { useState } from 'react';
import {
  Cloud, Package, Save, Trash2, AlertTriangle, ChevronDown, ChevronUp, FileText, Plus,
} from 'lucide-react';
import Button from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Field';
import { useTemplateCenter } from './TemplateCenterContext';

export default function DraftScopePanel() {
  const {
    drafts, networks, activeDraftId, selectDraft, startNewDraft,
    title, setTitle, scopeType, setScopeType, networkId, setNetworkId,
    minAppVersion, setMinAppVersion, minAppBuild, setMinAppBuild,
    draftIsDirty, markDirty, currentPointer, saving, working,
    saveDraft, publish, deleteDraft, loadBundledPack,
  } = useTemplateCenter();

  const [expanded, setExpanded] = useState(false);
  const activeDraft = drafts.find((d) => d.id === activeDraftId);

  const headerTitle = activeDraft?.title || title || 'مسودة جديدة';
  const headerMeta = draftIsDirty
    ? '⚠️ تغييرات غير محفوظة'
    : activeDraftId
      ? `${scopeType === 'network' ? networkId : 'عام'} • Android ≥ ${minAppVersion || '0.0.0'}`
      : 'لم تُحفظ بعد';

  return (
    <section className="rounded-2xl bg-[var(--ui-surface)] border border-line overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full p-3.5 flex items-start justify-between gap-3 hover:bg-[var(--ui-sunken)]/40 transition-colors text-right"
        aria-expanded={expanded}
      >
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${draftIsDirty ? 'bg-amber-100 text-amber-700' : 'bg-brand/10 text-brand-deep'}`}>
            <FileText className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-black text-[var(--ui-ink)] truncate">{headerTitle}</p>
              {activeDraftId && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--ui-sunken)] text-[var(--ui-muted)]">
                  {scopeType === 'network' ? 'شبكة' : 'عام'}
                </span>
              )}
            </div>
            <p className={`text-[11px] mt-0.5 truncate font-semibold ${draftIsDirty ? 'text-amber-700' : 'text-[var(--ui-muted)]'}`}>
              {headerMeta}
            </p>
          </div>
        </div>
        <span className="p-1 text-[var(--ui-muted)] flex-shrink-0">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {expanded && (
        <div className="px-3.5 pb-3.5 border-t border-line/60 pt-3 space-y-3">
          {/* مسودة */}
          <div className="grid gap-2">
            <Field label="المسودة" htmlFor="draft-select">
              <Select
                id="draft-select"
                value={activeDraftId}
                onChange={(event) => {
                  if (event.target.value === '') startNewDraft();
                  else selectDraft(event.target.value);
                }}
              >
                <option value="">+ مسودة جديدة</option>
                {drafts.map((draft) => (
                  <option key={draft.id} value={draft.id}>
                    {draft.title || 'مسودة بلا عنوان'}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="عنوان المسودة" htmlFor="draft-title" required>
              <Input
                id="draft-title"
                value={title}
                onChange={(e) => { setTitle(e.target.value); markDirty(); }}
                maxLength={120}
                placeholder="مثال: قوالب التحويل — أكتوبر"
              />
            </Field>
          </div>

          {/* النطاق */}
          <div className="grid grid-cols-2 gap-2">
            <Field label="نطاق النشر" htmlFor="draft-scope">
              <Select
                id="draft-scope"
                value={scopeType}
                onChange={(e) => {
                  setScopeType(e.target.value);
                  if (e.target.value === 'global') setNetworkId('');
                  markDirty();
                }}
              >
                <option value="global">عام لكل الشبكات</option>
                <option value="network">شبكة محددة</option>
              </Select>
            </Field>
            {scopeType === 'network' ? (
              <Field label="الشبكة" htmlFor="draft-network" required>
                <Select
                  id="draft-network"
                  value={networkId}
                  onChange={(e) => { setNetworkId(e.target.value); markDirty(); }}
                  required
                >
                  <option value="">اختر شبكة</option>
                  {networks.map((n) => (
                    <option key={n.id} value={n.id}>{n.name} · {n.id}</option>
                  ))}
                </Select>
              </Field>
            ) : (
              <div />
            )}
          </div>

          {/* التوافق */}
          <div className="grid grid-cols-2 gap-2">
            <Field label="أدنى إصدار Android" htmlFor="min-app-version" hint="x.y.z">
              <Input
                id="min-app-version"
                value={minAppVersion}
                onChange={(e) => setMinAppVersion(e.target.value)}
                pattern="^\d+\.\d+\.\d+$"
                maxLength={32}
                dir="ltr"
              />
            </Field>
            <Field label="versionCode الأدنى" htmlFor="min-app-build">
              <Input
                id="min-app-build"
                type="number"
                min="0"
                max="2147483647"
                value={minAppBuild}
                onChange={(e) => setMinAppBuild(e.target.value)}
              />
            </Field>
          </div>

          {/* الإجراءات */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-line/60">
            <Button icon={Save} size="sm" loading={saving} onClick={saveDraft}>
              حفظ المسودة
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={Package}
              onClick={loadBundledPack}
              title="استيراد الكتالوج الافتراضي"
            >
              استيراد
            </Button>
            <Button
              variant="success"
              size="sm"
              icon={Cloud}
              loading={working}
              disabled={!activeDraftId || draftIsDirty || (scopeType === 'network' && !networkId)}
              onClick={publish}
            >
              نشر
            </Button>
            {activeDraftId && (
              <Button variant="danger" size="sm" icon={Trash2} loading={working} onClick={deleteDraft}>
                حذف
              </Button>
            )}
          </div>

          {draftIsDirty && (
            <div className="flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              احفظ التغييرات قبل النشر
            </div>
          )}

          {currentPointer && (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
              الإصدار النشط: {currentPointer.version || currentPointer.releaseId}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

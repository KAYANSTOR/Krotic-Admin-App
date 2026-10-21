import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { callAdminApi, adminApiError } from '../../lib/adminApi';
import { EMPTY_PAYLOAD, cloneBundledPack } from '../../lib/bundledTemplatePack';
import { scopeKeyFor, selectVerifiedAck } from '../../lib/templateCenterView';

const TemplateCenterContext = createContext(null);

export function useTemplateCenter() {
  const value = useContext(TemplateCenterContext);
  if (!value) throw new Error('useTemplateCenter must be used within TemplateCenterProvider');
  return value;
}

/**
 * حالة مركز القوالب المشتركة بين التبويبات: المسودة، الإصدارات، المؤشرات،
 * الكتالوج، والشبكات. كل الإجراءات تمر عبر الخادم المحمي `/api/template-center`.
 *
 * مبدأ صارم: لا يُعرض أي إجراء كأنه «مطبَّق على الجهاز»؛ النشر يعني إصدارًا
 * مركزيًا فقط، والتطبيق على Android يبقى `Unknown` حتى يصل ACK موثوق.
 */
export function TemplateCenterProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [releases, setReleases] = useState([]);
  const [pointers, setPointers] = useState([]);
  const [acks, setAcks] = useState([]);
  const [networks, setNetworks] = useState([]);
  const [catalog, setCatalog] = useState(null);
  const [activeDraftId, setActiveDraftId] = useState('');
  const [draftIsDirty, setDraftIsDirty] = useState(false);
  const [scopeType, setScopeType] = useState('global');
  const [networkId, setNetworkId] = useState('');
  const [minAppVersion, setMinAppVersion] = useState('0.0.0');
  const [minAppBuild, setMinAppBuild] = useState('0');
  const [title, setTitle] = useState('');
  const [payload, setPayload] = useState(EMPTY_PAYLOAD);

  const activeDraft = drafts.find((item) => item.id === activeDraftId) || null;
  const scope = useMemo(() => ({
    type: scopeType,
    networkId: scopeType === 'network' ? networkId : null,
  }), [scopeType, networkId]);
  const currentPointer = pointers.find((item) => item.id === scopeKeyFor(scope)) || null;
  const currentAck = useMemo(
    () => selectVerifiedAck(acks, { releaseId: currentPointer?.releaseId ?? null, scopeKey: scopeKeyFor(scope) }),
    [acks, currentPointer?.releaseId, scope],
  );

  const request = useCallback(async (action, rest = {}) => {
    const response = await callAdminApi('/api/template-center', { action, ...rest });
    if (!response.ok) {
      const details = Array.isArray(response.data?.details) ? response.data.details.join('، ') : '';
      throw new Error([
        adminApiError(response.error, 'تعذر الاتصال بمركز القوالب'),
        details,
      ].filter(Boolean).join(' — '));
    }
    return response.data;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [data, networkData, catalogData] = await Promise.all([
        request('list'),
        request('list-networks'),
        request('catalog'),
      ]);
      setDrafts(data.drafts || []);
      setReleases(data.releases || []);
      setPointers(data.pointers || []);
      setAcks(data.acks || []);
      setNetworks(networkData.networks || []);
      setCatalog(catalogData.catalog || null);
      return true;
    } catch (error) {
      console.error('Template center loading failed:', error);
      toast.error(error.message || 'تعذر تحميل مركز القوالب');
      return false;
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    setMinAppVersion(currentPointer?.minAppVersion || '0.0.0');
    setMinAppBuild(String(currentPointer?.minAppBuild ?? 0));
  }, [currentPointer?.minAppVersion, currentPointer?.minAppBuild]);

  const markDirty = useCallback(() => setDraftIsDirty(true), []);

  /** يستبدل قسمًا واحدًا من حمولة المسودة (wallets / transferTemplates / outboundTemplates). */
  const setSection = useCallback((section, items) => {
    setPayload((previous) => ({ ...previous, [section]: items }));
    setDraftIsDirty(true);
  }, []);

  const startNewDraft = useCallback(() => {
    setActiveDraftId('');
    setDraftIsDirty(false);
    setTitle('');
    setScopeType('global');
    setNetworkId('');
    setPayload(EMPTY_PAYLOAD);
  }, []);

  const selectDraft = useCallback((id) => {
    setActiveDraftId(id);
    setDraftIsDirty(false);
    const selected = drafts.find((item) => item.id === id);
    if (!selected) {
      setTitle('');
      setScopeType('global');
      setNetworkId('');
      setPayload(EMPTY_PAYLOAD);
      return;
    }
    setTitle(selected.title || '');
    setScopeType(selected.scope?.type || 'global');
    setNetworkId(selected.scope?.networkId || '');
    setPayload({
      wallets: selected.payload?.wallets || [],
      transferTemplates: selected.payload?.transferTemplates || [],
      outboundTemplates: selected.payload?.outboundTemplates || [],
    });
  }, [drafts]);

  /** تحميل الحزمة المضمّنة إلى المسودة (إجراء محلي — ليس «زرعًا» على أي جهاز). */
  const loadBundledPack = useCallback(() => {
    if (draftIsDirty && !window.confirm('سيتم استبدال محتوى المسودة الحالية بالحزمة المضمّنة. هل تريد المتابعة؟')) {
      return;
    }
    setPayload(cloneBundledPack());
    if (!title.trim()) setTitle('حزمة المحافظ والقوالب اليمنية المعتمدة');
    setDraftIsDirty(true);
    toast.success('حُمّلت الحزمة المضمّنة إلى المسودة (محليًا فقط — لم تُحفظ أو تُنشر)');
  }, [draftIsDirty, title]);

  const saveDraft = useCallback(async () => {
    if (!title.trim()) {
      toast.error('أدخل عنوانًا للمسودة');
      return false;
    }
    if (scopeType === 'network' && !networkId) {
      toast.error('اختر الشبكة قبل حفظ المسودة');
      return false;
    }
    setSaving(true);
    try {
      const data = await request('save-draft', {
        draft: {
          id: activeDraft?.id,
          title: title.trim(),
          scope,
          payload,
          baseReleaseId: activeDraft?.baseReleaseId ?? currentPointer?.releaseId ?? null,
        },
      });
      const refreshed = await refresh();
      setActiveDraftId(data.id);
      setDraftIsDirty(false);
      if (refreshed) toast.success('حُفظت المسودة (لم يتغيّر الإصدار النشط)');
      else toast.error('حُفظت المسودة، لكن تعذر تحديث القائمة. أعد تحميل الصفحة.');
      return true;
    } catch (error) {
      console.error('Template draft save failed:', error);
      toast.error(error.message || 'تعذر حفظ المسودة');
      return false;
    } finally {
      setSaving(false);
    }
  }, [activeDraft, currentPointer, networkId, payload, request, refresh, scope, scopeType, title]);

  const publish = useCallback(async () => {
    if (!activeDraft) {
      toast.error('احفظ المسودة أولًا قبل النشر');
      return false;
    }
    if (!/^\d+\.\d+\.\d+$/.test(minAppVersion)
        || !/^\d+$/.test(minAppBuild)
        || Number(minAppBuild) > 2147483647) {
      toast.error('أدخل إصدارًا بصيغة x.y.z ورقم بناء صالحًا');
      return false;
    }
    if (!window.confirm('نشر هذه المسودة؟ سيصبح الإصدار نشطًا فورًا ضمن النطاق المحدد. لا يعني هذا تطبيقه على الأجهزة.')) {
      return false;
    }
    setWorking(true);
    try {
      await request('publish', {
        draftId: activeDraft.id,
        expectedReleaseId: currentPointer?.releaseId ?? null,
        minAppVersion,
        minAppBuild: Number(minAppBuild),
      });
      await refresh();
      toast.success('نُشر إصدار مركزي جديد (لم يُؤكَّد تطبيقه على أي جهاز بعد)');
      return true;
    } catch (error) {
      console.error('Template release publish failed:', error);
      toast.error(error.message || 'تعذر نشر الإصدار');
      return false;
    } finally {
      setWorking(false);
    }
  }, [activeDraft, currentPointer, minAppBuild, minAppVersion, refresh, request]);

  const rollback = useCallback(async (release) => {
    if (!window.confirm(`إنشاء إصدار جديد مطابق لمحتوى ${release.version || release.versionCode}؟`)) {
      return false;
    }
    setWorking(true);
    try {
      await request('rollback', { releaseId: release.id });
      await refresh();
      toast.success('أُنشئ إصدار تراجع مركزي جديد');
      return true;
    } catch (error) {
      console.error('Template release rollback failed:', error);
      toast.error(error.message || 'تعذر التراجع');
      return false;
    } finally {
      setWorking(false);
    }
  }, [refresh, request]);

  const deleteDraft = useCallback(async () => {
    if (!activeDraft || !window.confirm('حذف المسودة نهائيًا؟')) return false;
    setWorking(true);
    try {
      await request('delete-draft', { draftId: activeDraft.id });
      startNewDraft();
      await refresh();
      toast.success('حُذفت المسودة');
      return true;
    } catch (error) {
      toast.error(error.message || 'تعذر حذف المسودة');
      return false;
    } finally {
      setWorking(false);
    }
  }, [activeDraft, refresh, request, startNewDraft]);

  const simulateInbound = useCallback(async ({ body, sender }) => {
    setWorking(true);
    try {
      const data = await request('simulate-inbound', { payload, body, sender });
      return { ok: true, result: data.result };
    } catch (error) {
      toast.error(error.message || 'تعذرت محاكاة القالب');
      return { ok: false, error: error.message };
    } finally {
      setWorking(false);
    }
  }, [payload, request]);

  const previewOutbound = useCallback(async ({ template, values }) => {
    setWorking(true);
    try {
      const data = await request('preview-outbound', { template, values });
      return { ok: true, result: data.result };
    } catch (error) {
      toast.error(error.message || 'تعذرت معاينة الرسالة');
      return { ok: false, error: error.message };
    } finally {
      setWorking(false);
    }
  }, [request]);

  const value = useMemo(() => ({
    loading, saving, working,
    drafts, releases, pointers, acks, networks, catalog,
    currentAck,
    activeDraft, activeDraftId, selectDraft, startNewDraft,
    title, setTitle, scopeType, setScopeType, networkId, setNetworkId,
    minAppVersion, setMinAppVersion, minAppBuild, setMinAppBuild,
    payload, setSection, draftIsDirty, markDirty, scope, currentPointer,
    refresh, saveDraft, publish, rollback, deleteDraft, loadBundledPack,
    simulateInbound, previewOutbound,
  }), [
    loading, saving, working, drafts, releases, pointers, acks, networks, catalog,
    currentAck,
    activeDraft, activeDraftId, selectDraft, startNewDraft, title, scopeType,
    networkId, minAppVersion, minAppBuild, payload, setSection, draftIsDirty,
    markDirty, scope, currentPointer, refresh, saveDraft, publish, rollback,
    deleteDraft, loadBundledPack, simulateInbound, previewOutbound,
  ]);

  return <TemplateCenterContext.Provider value={value}>{children}</TemplateCenterContext.Provider>;
}

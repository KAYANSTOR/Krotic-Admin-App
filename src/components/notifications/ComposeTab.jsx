import { useState, useMemo, useEffect, useDeferredValue } from 'react';
import {
  Globe, User, Sparkles, Clock, Radio, Search, X, Send, Smartphone,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '../ui/Card';
import Button from '../ui/Button';
import {
  AUDIENCE, TITLE_MAX, MESSAGE_MAX, DEFAULT_QUICK_PRESETS,
} from '../../lib/notifications/constants';
import { isBuiltinTemplate, userOptionLabel } from '../../lib/notifications/templates';
import { toLocalDateTimeInput } from '../../lib/notifications/timestamps';

export default function ComposeTab({
  users,
  templates,
  sending,
  hidden = false,
  requestedTemplateId = null,
  onRequestedTemplateHandled,
  onSend,
  onSaveTemplate,
  onOpenPhoneModal,
}) {
  const [type, setType] = useState(AUDIENCE.GLOBAL);
  const [selectedUser, setSelectedUser] = useState('');
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [templateId, setTemplateId] = useState('');

  const deferredUserSearch = useDeferredValue(userSearchTerm);
  const filteredUsers = useMemo(() => {
    const query = deferredUserSearch.trim().toLocaleLowerCase();
    if (!query) return users;
    return users.filter((user) => (
      String(user.name || user.networkName || user.network_name || '').toLocaleLowerCase().includes(query)
      || String(user.phone || user.phoneNumber || '').includes(query)
      || String(user.uid || '').toLocaleLowerCase().includes(query)
    ));
  }, [users, deferredUserSearch]);

  const selectedUserName = useMemo(() => {
    const user = users.find((item) => item.uid === selectedUser);
    return user ? userOptionLabel(user) : '';
  }, [users, selectedUser]);

  // Keep the select value valid whenever a search removes the selected user.
  useEffect(() => {
    if (type === AUDIENCE.USER && selectedUser
      && !filteredUsers.some((user) => user.uid === selectedUser)) {
      setSelectedUser('');
    }
  }, [type, selectedUser, filteredUsers]);

  const scheduledMin = toLocalDateTimeInput(Date.now() + 5 * 60 * 1000);
  const canSend = title.trim().length > 0
    && message.trim().length > 0
    && (type === AUDIENCE.GLOBAL || Boolean(selectedUser))
    && !sending;

  const applyTemplate = (id) => {
    setTemplateId(id);
    const template = templates.find((item) => item.id === id);
    if (!template) return false;
    setTitle(template.title);
    setMessage(template.message);
    toast.success(`تم اختيار قالب: ${template.name}`);
    return true;
  };

  useEffect(() => {
    if (!requestedTemplateId) return;
    if (applyTemplate(requestedTemplateId)) onRequestedTemplateHandled?.();
  }, [requestedTemplateId, templates]);

  const applyQuickPreset = (preset) => {
    setTemplateId('');
    setTitle(preset.title);
    setMessage(preset.message);
    toast.success('تم تطبيق النموذج الجاهز.');
  };

  const clearDraft = () => {
    setTemplateId('');
    setTitle('');
    setMessage('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSend) return;
    const succeeded = await onSend({ type, selectedUser, title, message, scheduledAt });
    if (succeeded) {
      setTitle('');
      setMessage('');
      setScheduledAt('');
      setTemplateId('');
    }
  };

  const handleSave = () => {
    if (!title.trim() || !message.trim()) {
      toast.error('اكتب العنوان والنص أولاً لحفظهما كقالب.');
      return;
    }
    onSaveTemplate({ title: title.trim(), message: message.trim() });
  };

  const builtinTemplates = templates.filter(isBuiltinTemplate);
  const savedTemplates = templates.filter((template) => !isBuiltinTemplate(template));

  return (
    <div className="space-y-4" hidden={hidden}>
      <div className="space-y-2">
        <span className="text-xs font-bold text-ink-soft flex items-center gap-1.5 px-1">
          <Sparkles className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
          نماذج رسائل سريعة بنقرة واحدة:
        </span>
        <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar touch-pan-x">
          {DEFAULT_QUICK_PRESETS.map((preset) => (
            <button
              key={preset.title}
              type="button"
              onClick={() => applyQuickPreset(preset)}
              className="flex-shrink-0 text-right px-3 py-2 min-h-[44px] bg-surface hover:bg-surface-sunken border border-line rounded-xl text-xs font-semibold text-ink transition-all active:scale-95 shadow-xs max-w-[220px]"
            >
              {preset.title}
            </button>
          ))}
        </div>
      </div>

      <Card className="notif-compose p-4 sm:p-6 rounded-2xl shadow-sm border border-line">
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="space-y-1.5 p-3.5 bg-brand-soft/10 rounded-xl border border-brand/20">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-bold text-ink flex items-center gap-1.5" htmlFor="notif-template-select">
                <Sparkles className="w-4 h-4 text-brand" aria-hidden="true" />
                <span>قوالب جاهزة للإشعارات</span>
              </label>
              {templateId && (
                <button
                  type="button"
                  onClick={() => { clearDraft(); toast('تم تفريغ الحقول.', { icon: '🧹' }); }}
                  className="text-[11px] text-brand hover:underline font-bold min-h-[44px] px-2"
                >
                  تفريغ الحقول
                </button>
              )}
            </div>
            <select
              id="notif-template-select"
              value={templateId}
              onChange={(event) => {
                const value = event.target.value;
                if (value) applyTemplate(value);
                else setTemplateId('');
              }}
              className="input-field bg-surface text-ink text-xs sm:text-sm font-semibold border-line focus:border-brand"
            >
              <option value="">— اختر قالباً لتعبئة الحقول —</option>
              {builtinTemplates.length > 0 && (
                <optgroup label="القوالب الجاهزة">
                  {builtinTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} — {template.title.slice(0, 45)}
                    </option>
                  ))}
                </optgroup>
              )}
              {savedTemplates.length > 0 && (
                <optgroup label="القوالب المحفوظة">
                  {savedTemplates.map((template) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <p className="text-[11px] text-muted leading-tight">
              يمكنك تعديل العنوان والنص بعد اختيار القالب وقبل الإرسال.
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-bold text-ink-soft">نوع الجمهور المستهدف</legend>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                aria-pressed={type === AUDIENCE.GLOBAL}
                onClick={() => { setType(AUDIENCE.GLOBAL); setSelectedUser(''); }}
                className={`flex items-center gap-3 p-3.5 min-h-[64px] rounded-xl border text-right transition-all ${
                  type === AUDIENCE.GLOBAL
                    ? 'border-brand bg-brand-soft/20 text-brand-deep font-bold ring-2 ring-brand/30 shadow-xs'
                    : 'border-line bg-surface text-ink-soft hover:bg-surface-sunken'
                }`}
              >
                <span className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                  type === AUDIENCE.GLOBAL ? 'bg-brand text-white' : 'bg-surface-sunken text-muted'
                }`}>
                  <Globe className="w-5 h-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-sm font-bold leading-tight">للجميع</span>
                  <span className="block text-xs text-muted mt-0.5">كافة الهواتف المسجلة</span>
                </span>
              </button>

              <button
                type="button"
                aria-pressed={type === AUDIENCE.USER}
                onClick={() => setType(AUDIENCE.USER)}
                className={`flex items-center gap-3 p-3.5 min-h-[64px] rounded-xl border text-right transition-all ${
                  type === AUDIENCE.USER
                    ? 'border-brand bg-brand-soft/20 text-brand-deep font-bold ring-2 ring-brand/30 shadow-xs'
                    : 'border-line bg-surface text-ink-soft hover:bg-surface-sunken'
                }`}
              >
                <span className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                  type === AUDIENCE.USER ? 'bg-brand text-white' : 'bg-surface-sunken text-muted'
                }`}>
                  <User className="w-5 h-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-sm font-bold leading-tight">لمشترك محدد</span>
                  <span className="block text-xs text-muted mt-0.5">هواتف شبكة واحدة</span>
                </span>
              </button>
            </div>
          </fieldset>

          {type === AUDIENCE.USER && (
            <div className="space-y-2 p-3 bg-surface-sunken/60 rounded-xl border border-line">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="text-xs font-bold text-ink" htmlFor="notif-user-select">اختر المشترك المستلم</label>
                {selectedUserName && <span className="text-xs text-brand font-bold">المحدد: {selectedUserName}</span>}
              </div>
              <div className="relative">
                <Search className="w-4 h-4 absolute right-3 top-3 text-muted pointer-events-none" aria-hidden="true" />
                <input
                  type="search"
                  placeholder="ابحث باسم المشترك أو الرقم..."
                  value={userSearchTerm}
                  onChange={(event) => setUserSearchTerm(event.target.value)}
                  className="input-field pr-9 text-xs"
                />
                {userSearchTerm && (
                  <button
                    type="button"
                    onClick={() => setUserSearchTerm('')}
                    className="absolute left-3 top-2.5 text-muted hover:text-ink"
                    aria-label="مسح البحث"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              {filteredUsers.length === 0 ? (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2" role="status">
                  لا توجد نتائج مطابقة. جرّب كلمة بحث أخرى.
                </p>
              ) : (
                <select
                  id="notif-user-select"
                  value={selectedUser}
                  onChange={(event) => setSelectedUser(event.target.value)}
                  className="input-field"
                  required
                >
                  <option value="">— اختر من القائمة ({filteredUsers.length} متاح) —</option>
                  {filteredUsers.map((user) => (
                    <option key={user.uid} value={user.uid}>{userOptionLabel(user)}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-ink" htmlFor="notif-title-input">عنوان الإشعار</label>
              <span className="text-[11px] text-muted" aria-live="polite">{title.length}/{TITLE_MAX}</span>
            </div>
            <input
              id="notif-title-input"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="input-field"
              placeholder="مثال: تنبيه هام، تحديث جديد، تذكير بالاشتراك..."
              maxLength={TITLE_MAX}
              required
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-ink" htmlFor="notif-body-input">نص رسالة الإشعار</label>
              <span className="text-[11px] text-muted" aria-live="polite">{message.length}/{MESSAGE_MAX}</span>
            </div>
            <textarea
              id="notif-body-input"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="input-field resize-none leading-relaxed"
              rows={4}
              placeholder="اكتب تفاصيل الإشعار بوضوح هنا..."
              maxLength={MESSAGE_MAX}
              required
            />
          </div>

          <div className="p-3 bg-surface-sunken/40 rounded-xl border border-line space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-ink">
              <Clock className="w-4 h-4 text-brand" aria-hidden="true" />
              <span>جدولة الإرسال لوقت لاحق (اختياري)</span>
            </div>
            <input
              type="datetime-local"
              value={scheduledAt}
              min={scheduledMin}
              onChange={(event) => setScheduledAt(event.target.value)}
              className="input-field text-xs min-h-[44px]"
            />
            <p className="text-[11px] text-muted leading-tight">
              اترك الحقل فارغاً للإرسال الفوري. يفحص الموزّع الخادمي الإشعارات المجدولة مرة واحدة يومياً قرابة 06:00 UTC.
            </p>
          </div>

          <div className="space-y-1.5 pt-1">
            <label className="text-xs font-bold text-ink-soft flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
              معاينة الإشعار كما سيظهر على شاشة هاتف المستخدم:
            </label>
            <div className="p-3.5 rounded-2xl bg-slate-900 text-white shadow-md border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-brand flex items-center justify-center text-[9px] font-bold text-white">K</span>
                  <span className="font-semibold text-slate-300">كروتك برو</span>
                  <span>•</span>
                  <span className="text-[11px]">الآن</span>
                </div>
                <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded-full text-slate-300">
                  {type === AUDIENCE.GLOBAL ? 'عام' : (selectedUserName || 'خاص')}
                </span>
              </div>
              <div className="space-y-0.5 pr-1">
                <p className="text-sm font-bold text-slate-100">{title.trim() || 'عنوان الإشعار سيظهر هنا'}</p>
                <p className="text-xs text-slate-300 leading-relaxed">{message.trim() || 'نص رسالة الإشعار سيظهر هنا للمستخدم فور إرساله.'}</p>
              </div>
            </div>
          </div>

          <div className="pt-2 flex flex-col gap-2">
            <Button
              type="submit"
              variant="primary"
              size="lg"
              block
              loading={sending}
              disabled={!canSend}
              icon={sending ? undefined : Send}
              className="h-13 text-base font-extrabold shadow-md shadow-brand/25 active:scale-98"
            >
              {sending
                ? (scheduledAt ? 'جارٍ الجدولة…' : 'جارٍ إرسال الإشعار…')
                : (scheduledAt ? 'جدولة الإشعار' : 'إرسال الإشعار الآن')}
            </Button>
            {title.trim() && message.trim() && (
              <button
                type="button"
                onClick={handleSave}
                className="text-xs text-brand-deep hover:underline text-center py-2 min-h-[44px] font-semibold"
              >
                + حفظ النص الحالي كقالب للاستخدام المستقبلي
              </button>
            )}
          </div>
        </form>
      </Card>

      <div className="text-center">
        <Button variant="secondary" size="sm" onClick={onOpenPhoneModal} className="min-h-[44px]">
          <Smartphone className="w-4 h-4 ml-1" aria-hidden="true" />
          إشعارات هاتفي الحية
        </Button>
      </div>
    </div>
  );
}

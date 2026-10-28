import { Plus, Send } from 'lucide-react';
import Button from '../ui/Button';
import { isBuiltinTemplate } from '../../lib/notifications/templates';

export default function TemplatesTab({ templates, hidden = false, onUse, onDelete, onCreate }) {
  return (
    <div className="space-y-3" hidden={hidden}>
      <div className="flex items-center justify-between px-1 gap-2">
        <span className="text-xs font-bold text-ink-soft">القوالب المحفوظة ({templates.length})</span>
        <Button variant="secondary" size="sm" icon={Plus} onClick={onCreate} className="min-h-[44px]">
          إنشاء قالب جديد
        </Button>
      </div>

      {templates.length === 0 ? (
        <p className="p-5 text-sm text-muted rounded-xl border border-dashed border-line">لا توجد قوالب محفوظة.</p>
      ) : (
        <div className="grid gap-2.5">
          {templates.map((template) => {
            const builtin = isBuiltinTemplate(template);
            return (
              <article key={template.id} className="p-3.5 rounded-2xl bg-surface border border-line shadow-xs flex flex-col justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-ink">{template.name}</h4>
                  {builtin && <span className="inline-flex mt-1 text-[10px] font-bold text-brand-deep">قالب جاهز</span>}
                  <p className="text-xs text-ink-soft mt-1 line-clamp-2 leading-relaxed">{template.message}</p>
                </div>
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-line/60">
                  <button type="button" onClick={() => onUse(template.id)} className="text-xs font-bold text-brand hover:underline flex items-center gap-1 min-h-[44px]">
                    <Send className="w-3 h-3" aria-hidden="true" />
                    استخدام في النموذج
                  </button>
                  {!builtin && (
                    <button type="button" onClick={() => onDelete(template.id)} className="text-xs text-danger hover:underline p-2 min-h-[44px]">
                      حذف القالب
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

# سياسة احتفاظ بيانات WhatsApp (خادمي)

**الحالة:** منطق الحذف منفَّذ في الكود؛ **التشغيل الدوري غير مفعّل** حتى اعتماد Cloud Scheduler + سر الخدمة.

## المدد المعتمدة

| البيانات | المدة | الإجراء |
|---|---|---|
| جسم Webhook الخام | لا يُخزَّن | — |
| نص الرسالة (`text`) | 72 ساعة | تصفير `text` و`textRetentionUntilMs`؛ **الإبقاء على سجل الحدث** |
| سجل الحدث | 90 يوماً | حذف مستند `whatsapp_inbound_events/{id}` |
| أسرار Meta | Secret Manager فقط | خارج Firestore |

## الحقول على الحدث

- `textRetentionUntilMs` — موعد تصفير النص
- `eventExpiresAtMs` — موعد حذف السجل بالكامل
- `textPurgedAtMs` — يُضبط عند تصفير النص فعلياً
- `receivedAtMs` — احتياطي لحساب انتهاء السجل إن غاب `eventExpiresAtMs`

## آلية الحذف

1. **صريحة عبر Admin SDK** (`applyRetentionToEvent` / `runRetentionPass`) — ليست TTL تلقائية حالياً.
2. مسار منفصل: `POST /api/whatsapp/retention/purge` (سر خدمة فقط).
3. **ليس** جزءاً من `/api/whatsapp/delivery/dispatch`.

### Firestore TTL (اختياري لاحقاً)

يمكن تفعيل TTL على `eventExpiresAtMs` لحذف السجلات تلقائياً، لكنه **لا يصفّر النص عند 72 ساعة** دون حذف المستند. لذلك الحذف الصريح مفضّل للمرحلتين.

### Cloud Scheduler (مطلوب للتفعيل الدوري)

```text
جدول مقترح: كل ساعة
POST https://<host>/api/whatsapp/retention/purge
Header: x-dispatch-service-secret: <from Secret Manager>
```

حتى يتم ذلك: `schedulingActive: false` في استجابة المسار.

## الفهارس المقترحة للاستعلام الإنتاجي

- `whatsapp_inbound_events`: `textRetentionUntilMs` ASC (للنصوص المنتهية)
- `whatsapp_inbound_events`: `eventExpiresAtMs` ASC (للسجلات المنتهية)
- `networks`: `whatsappPhoneNumberId` ASC (ربط Webhook بالشبكة)

معرّفة في `firestore.indexes.json` — تحتاج `firebase deploy --only firestore:indexes` بموافقتك.

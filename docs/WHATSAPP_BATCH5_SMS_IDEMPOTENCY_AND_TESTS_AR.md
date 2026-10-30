# الدفعة 5 — تكرار SMS، الصلاحيات، والاختبارات

**الفرع:** `تكامل-مزايا-المدفوعة`

## 1. دورة SMS وحدود الضمان

| المرحلة | السلوك |
|---|---|
| claim | قفل ذري على `deliveryOperationId` |
| request_started | يُسجَّل قبل استدعاء المزود |
| provider_accepted | بعد قبول المزود، قبل `sms_sent` |
| persisted | `smsFallbackSentAtMs` + status `sms_sent` |

**مفتاح Idempotency:** `krotak-wa-sms:{deliveryOperationId}` (ثابت = networkId + saleUuid).

| دعم المزود | ضماننا |
|---|---|
| يدعم Idempotency-Key | إعادة المحاولة بنفس المفتاح آمنة عند المزود |
| لا يدعم | بعد `request_started` بلا accept → `smsOutcomeUnknown` **يمنع** إعادة الإرسال التلقائي |

**ما لا يمكن ضمانه دون مزود:** exactly-once عند الناقل إذا ماتت العملية بعد قبول المزود دون persist ولم يدعم المزود idempotency.

## 2. مهلة 10 ثوانٍ

`WHATSAPP_CONFIRMATION_WINDOW_MS = 10_000` لم يتغير.

| المفهوم | الواقع |
|---|---|
| تسجيل `whatsappDeadlineAtMs` | منفَّذ عند `sent` |
| تنفيذ SMS عند الاستحقاق | يحدث فقط عند تشغيل `dispatch` |
| ضمان زمني ±10ث | **غير محقق** بدون موقظ موثوق |

## 3. صلاحيات network-config

- الهوية من `authenticateAdmin` (Bearer + مستند Admins)
- رفض 401/403 دون أدمن
- لا Access Token في الاستجابة
- الشبكة يجب أن توجد (`404` إن لم توجد)

## 4. اختبارات Emulator

```bash
npx firebase-tools emulators:exec --project demo-krotic-local --only firestore \
  "node --test test/whatsappEmulator.integration.test.js"
```

بدون `FIRESTORE_EMULATOR_HOST` تُتخطى باختبار skip (لا تُحذف اختبارات fakeFirestore).

## 5. ما يمنع الإرسال الفعلي

1. عدم ضبط مزود SMS حقيقي + idempotency
2. عدم ضبط أسرار Meta في Vercel
3. عدم وجود موقظ لمهلة 10ث
4. المرحلة 0 غير مكتملة

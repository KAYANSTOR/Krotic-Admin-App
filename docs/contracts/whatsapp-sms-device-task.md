# عقد مهمة إرسال SMS لجهاز صاحب الشبكة

**المصدر:** Krotak-Pro `feature/paid-features` → `docs/contracts/whatsapp-sms-device-task.md`
**مرجع الخادم:** `server/_lib/whatsapp/smsDeviceTaskContract.js`
**مرجع المنسّق:** `docs/contracts/whatsapp-gateway-api.md` §7

## المجموعة والحقول

المجموعة: `whatsapp_sms_device_tasks` · معرّف الوثيقة: `taskId === deliveryOperationId`.

| الحقل | نوعه | من يكتبه | ملاحظات |
|---|---|---|---|
| `taskId` | string | الخادم | ثابت، يساوي `deliveryOperationId` |
| `deliveryOperationId` | string | الخادم | معرّف عملية التسليم |
| `networkId` | string | الخادم | شبكة صاحب المهمة |
| `ownerUid` | string | الخادم | حساب صاحب الشبكة |
| `toLocalPhone` | string | الخادم | يُرسل حرفيًا |
| `body` | string | الخادم | نص البطاقة نفسه |
| `status` | string | الخادم + الجهاز | `queued`/`claimed`/`sent`/`failed`/`expired` فقط |
| `claimOwnerDeviceId` | string \| null | الجهاز | `installationId` |
| `claimUntilMs` | int \| null | الجهاز | انتهاء الحجز |
| `deviceSentAtMs` | int \| null | الجهاز | وقت الإرسال |
| `deviceError` | string \| null | الجهاز | رمز قصير فقط |
| `createdAtMs` / `updatedAtMs` | int | الخادم / الجهاز | بالميلي ثانية |

`status` في هذه المجموعة **ليست** حالات `whatsapp_delivery_operations`.
`sent` هنا تعني قبول مسار الإرسال، وليست تسليمًا للعميل.

## قواعد المنسّق

- `tryStartSmsFallback` → `sms_pending` فقط + إنشاء المهمة.
- `completeSmsFallbackFromDevice` هو المسار الوحيد إلى `sms_sent` بعد نتيجة جهاز فعلية.
- `unknown` / `sms_result_unknown` → تدخل بشري، بلا إعادة إرسال آلية.

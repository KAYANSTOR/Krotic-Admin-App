# عقد حالة جلسة البوابة (غير سرّية) — خيار المالك 1

**القرار:** الخدمة تكتب حالة غير سرّية فقط إلى وثيقة Firestore تقرأها اللوحة.
**لا** مسار `/v1/admin/...`.
**المرجع الحاكم:** `docs/contracts/whatsapp-gateway-api.md`

---

## 1. الوثيقة

```
whatsapp_gateway_sessions/{networkId}
```

- `networkId` = معرّف الشبكة نفسه.
- تكتبها **خدمة البوابة فقط** (حساب خدمة / Admin SDK).
- تقرأها اللوحة (Admin) والمالك (قراءة فقط لشبكته إن لزم لاحقًا).
- **ممنوع** تخزين: QR، مفاتيح، جلسة مشفّرة، نص رسالة، رقم هاتف كامل، Access Token.

---

## 2. الحقول المسموحة فقط

| الحقل | نوع | قيم / ملاحظات |
|-------|-----|----------------|
| `networkId` | string | يطابق معرّف الوثيقة |
| `status` | string | إحدى الحالات الثمانية أدناه فقط |
| `lastSeenAtMs` | number \| null | آخر نبض حي من المحرك |
| `reasonCode` | string \| null | رمز قصير غير سرّي (مثل `logged_out`, `connection_lost`) |
| `deviceName` | string \| null | اسم الجهاز المعروض فقط (≤ 64 حرفًا) |
| `linkedAtMs` | number \| null | أول ربط ناجح |
| `updatedAtMs` | number | وقت آخر كتابة من الخدمة |
| `engineVersion` | string \| null | إصدار المحرك إن وُجد (غير سرّي) |

### حالات `status` (ثمانية فقط — لا تُخترع)

```
unlinked
qr_pending
linking
linked
disconnected
relink_required
error
unknown
```

---

## 3. علاقة مع `networks/{networkId}`

| الحقل على الشبكة | من يكتب | ملاحظة |
|------------------|---------|--------|
| `whatsappPrimaryProvider` | اللوحة فقط | `cloud_api` \| `local_gateway_qr` |
| `whatsappCloudLinkStatus` | اللوحة / الخدمة السحابية | لحالة Cloud API فقط |
| باقي حقول Cloud غير السرية | كما في `networkConfig.js` | لا جلسة Gateway |

- عند `whatsappPrimaryProvider === 'local_gateway_qr'` تُقرأ حالة الجلسة من `whatsapp_gateway_sessions/{networkId}`.
- عند `cloud_api` تُتجاهل وثيقة الجلسة للعرض الأساسي.

---

## 4. ما تعرضه اللوحة

- `status` / `lastSeenAtMs` / `reasonCode` / `deviceName`
- تفعيل/تعطيل المزود لكل شبكة (`whatsappPrimaryProvider`)
- إلغاء جلسة (يستدعي مسار البوابة المصادق عليه، لا يكتب اللوحة الجلسة مباشرة)
- مراقبة `unknown` ورسائل التسليم كحالات تحتاج تدخلًا
- **ممنوع** عرض أو تخزين QR أو أسرار

---

## 5. قواعد الكتابة

1. الخدمة وحدها تُنشئ/تحدّث الوثيقة.
2. أي حقل خارج الجدول أعلاه يُرفض أو يُتجاهل.
3. لا تُنسخ مادة الجلسة أو QR إلى Firestore.
4. عند `unlink` / حذف جلسة: `status = unlinked` وتصفير الحقول الاختيارية.
5. عند انقطاع غير محسوم: `status = unknown` + `reasonCode` مناسب — بلا إعادة إرسال آلية.

---

## 6. قواعد Firestore (مسودة حد أدنى)

```
match /whatsapp_gateway_sessions/{networkId} {
  allow read: if isAdmin() || isNetworkOwner(networkId);
  allow write: if false; // Admin SDK / service account only
}
```

(التفاصيل النهائية تُنشر مع قواعد المشروع؛ الكتابة من العميل ممنوعة.)

# عقد حالة جلسة البوابة (غير سرّية) — خيار المالك 1

**القرار:** محرك Render يرسل حالة غير سرّية موقعة إلى Vercel؛ Vercel وحده يكتب وثيقة Firestore التي تقرأها اللوحة.
**لا** مسار `/v1/admin/...`.
**المرجع الحاكم:** `docs/contracts/whatsapp-gateway-api.md`

---

## 1. الوثيقة

```
whatsapp_gateway_sessions/{networkId}
```

- `networkId` = معرّف الشبكة نفسه.
- يكتبها **خادم Vercel فقط** عبر Firebase Admin SDK بعد تحقق HMAC.
- خدمة Render لا تملك ولا تستقبل بيانات اعتماد Firebase Admin.
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

1. يرسل المحرك `POST /api/whatsapp/gateway/status` مع `X-Network-Id`, `X-Gateway-Timestamp` و`X-Gateway-Signature: sha256=…`.
2. يوقّع HMAC-SHA256 الجسم JSON القانوني باستخدام السر المشترك `GATEWAY_SERVICE_TOKEN` / `WHATSAPP_GATEWAY_SERVICE_TOKEN`، ويجب ألا يتجاوز عمر الطابع الزمني خمس دقائق.
3. يتحقق Vercel من تطابق معرّف الشبكة بين الرأس والجسم، ومن قائمة الحقول والحالات المسموحة؛ أي حقل إضافي مثل QR أو token يُرفض.
4. يخصص Render طابع `updatedAtMs` رتيباً لكل شبكة، يخزّنه مشفراً على القرص الدائم، ويرسل callbacks متسلسلة. يرفض Vercel أي طابع مساوٍ أو أقدم من المخزن (`incoming <= stored`)؛ وهذا يمنع callback مكرراً أو متأخراً من قلب الحالة حتى عندما تقع الأحداث في المللي ثانية نفسها.
5. لا تُنسخ مادة الجلسة أو QR إلى Firestore؛ عند `unlink` تُصفّر الحقول الاختيارية، وعند انقطاع غير محسوم تُستخدم `unknown` مع `reasonCode` مناسب.

---

## 6. قواعد Firestore (مسودة حد أدنى)

```
match /whatsapp_gateway_sessions/{networkId} {
  allow read: if isAdmin() || isNetworkOwner(networkId);
  allow write: if false; // Admin SDK / service account only
}
```

(الكتابة من Android والعميل ممنوعة؛ محرك Render لا يملك Firebase credentials. لا تفتح كتابة Firestore المباشرة لهذا المسار.)

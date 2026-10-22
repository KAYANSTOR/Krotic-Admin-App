// قرار تهيئة جلسة المدير (POST /api/admin-session, action=bootstrap).
// لا يُنشأ مستند مدير إلا للمالك الأساسي؛ المدراء الآخرون يُنشأون عبر /api/admins.
export function decideAdminBootstrap({
  callerUid,
  callerEmail,
  emailVerified,
  existingAdminData,
  primaryUid,
  primaryEmail,
}) {
  if (!callerUid) return { allow: false, create: false, error: 'not_admin' };

  if (existingAdminData && existingAdminData.uid === callerUid) {
    return { allow: true, create: false };
  }

  const email = String(callerEmail || '').trim().toLowerCase();
  const primary = String(primaryEmail || '').trim().toLowerCase();
  const isPrimaryUid = Boolean(primaryUid) && callerUid === primaryUid;
  const isPrimaryVerifiedEmail = Boolean(primary) && email === primary && emailVerified === true;

  if (isPrimaryUid || isPrimaryVerifiedEmail) return { allow: true, create: true };
  return { allow: false, create: false, error: 'not_admin' };
}
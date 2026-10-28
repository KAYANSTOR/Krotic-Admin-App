export function isBuiltinTemplate(template) {
  return String(template?.id || '').startsWith('builtin-');
}

export function userOptionLabel(user) {
  const name = user?.name
    || user?.networkName
    || user?.network_name
    || user?.uid
    || 'مشترك غير محدد';
  const phone = user?.phone || user?.phoneNumber;
  return phone ? `${name} (${phone})` : String(name);
}

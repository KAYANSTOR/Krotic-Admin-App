// src/lib/phoneNotifications.js
/**
 * إدارة إشعارات الهاتف الحية (Web Push / Phone System Notifications)
 * للمبيعات الحية وتسجيل المستخدمين الجدد مع إمكانية التشغيل والإلغاء.
 */

const PREFS_STORAGE_KEY = 'krotak_phone_notifications_prefs';
const PREFS_CHANGE_EVENT = 'krotak-notification-prefs-changed';

export const DEFAULT_NOTIFICATION_PREFS = {
  enabled: true,       // التشغيل / الإلغاء العام
  salesAlerts: true,   // إشعارات المبيعات الجديدة
  userAlerts: true,    // إشعارات تسجيل حساب جديد
  sound: true,         // التنبيه الصوتي
  vibrate: true,       // الاهتزاز في الهواتف
};

/** قراءة تفضيلات الإشعارات الحالية من التخزين المحلي */
export function getNotificationPreferences() {
  if (typeof window === 'undefined') return { ...DEFAULT_NOTIFICATION_PREFS };
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_NOTIFICATION_PREFS };
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed.enabled !== false,
      salesAlerts: parsed.salesAlerts !== false,
      userAlerts: parsed.userAlerts !== false,
      sound: parsed.sound !== false,
      vibrate: parsed.vibrate !== false,
    };
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFS };
  }
}

/** حفظ تفضيلات الإشعارات وبث التغيير لكل مكونات التطبيق */
export function saveNotificationPreferences(prefs) {
  if (typeof window === 'undefined') return;
  const merged = { ...getNotificationPreferences(), ...prefs };
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(merged));
  } catch (error) {
    console.error('Failed to save notification preferences:', error);
  }
  window.dispatchEvent(new CustomEvent(PREFS_CHANGE_EVENT, { detail: merged }));
  return merged;
}

/** الاشتراك في تغييرات التفضيلات */
export function subscribeNotificationPreferences(callback) {
  if (typeof window === 'undefined') return () => {};
  const handler = (event) => callback(event.detail || getNotificationPreferences());
  window.addEventListener(PREFS_CHANGE_EVENT, handler);
  return () => window.removeEventListener(PREFS_CHANGE_EVENT, handler);
}

/** فحص هل الإشعارات مدعومة في المتصفح/الهاتف */
export function isNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** استرجاع حالة إذن الإشعارات */
export function getNotificationPermission() {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission; // 'granted' | 'denied' | 'default'
}

/** طلب إذن إشعارات الهاتف من المستخدم */
export async function requestNotificationPermission() {
  if (!isNotificationSupported()) return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch (error) {
    console.error('Error requesting notification permission:', error);
    return Notification.permission;
  }
}

/** تشغيل نغمة تنبيه صوتية لطيفة خفيفة بدون ملفات خارجية عبر Web Audio API */
export function playNotificationChime() {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    // نغمة صاعدة مبهجة ولطيفة
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5
    osc.frequency.exponentialRampToValueAtTime(1174.66, now + 0.28); // D6

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.4);

    setTimeout(() => {
      try { ctx.close(); } catch {}
    }, 600);
  } catch {
    // تجاهل أي منع للتشغيل التلقائي من المتصفح
  }
}

/** اهتزاز الهاتف عند التنبيه */
export function triggerVibration(pattern = [120, 60, 120]) {
  if (typeof window === 'undefined') return;
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {}
}

/**
 * إرسال إشعار حي إلى شريط إشعارات الهاتف / النظام
 * @param {Object} options
 * @param {string} options.title - عنوان الإشعار
 * @param {string} options.body - نص الإشعار
 * @param {string} [options.url] - الرابط لفتحه عند الضغط على الإشعار
 * @param {string} [options.tag] - لمنع تكرار الإشعار
 * @param {'sale'|'user'|'test'} [options.type] - نوع الإشعار للتحقق من التفضيلات
 */
export async function dispatchPhoneNotification({
  title,
  body,
  url = '/',
  tag,
  type = 'sale',
  icon = '/icons/krotak-pro-192.png',
}) {
  const prefs = getNotificationPreferences();

  // التحقق من التفضيلات: هل الإشعارات مفعلة؟
  if (!prefs.enabled) return false;
  if (type === 'sale' && !prefs.salesAlerts) return false;
  if (type === 'user' && !prefs.userAlerts) return false;

  // تشغيل الصوت والاهتزاز
  if (prefs.sound) playNotificationChime();
  if (prefs.vibrate) triggerVibration();

  // التحقق من توفر إذن إشعارات النظام
  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    return false;
  }

  const notificationOptions = {
    body,
    icon,
    badge: icon,
    tag: tag || `krotak-${Date.now()}`,
    data: { url },
    vibrate: [120, 60, 120],
    dir: 'rtl',
    lang: 'ar',
    renotify: true,
  };

  try {
    // المحاولة عبر Service Worker لظهور أفضل على أجهزة الأندرويد والهواتف
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, notificationOptions);
        return true;
      }
    }

    // بديل عبر Notification API المباشر
    const notif = new Notification(title, notificationOptions);
    notif.onclick = () => {
      window.focus();
      if (url && typeof window !== 'undefined') {
        window.location.href = url;
      }
      try { notif.close(); } catch {}
    };
    return true;
  } catch (error) {
    console.warn('[v0] Could not dispatch phone notification:', error);
    return false;
  }
}

/** اختبار إشعار فوري للتأكد من وصوله على الهاتف */
export async function sendTestPhoneNotification() {
  const perm = await requestNotificationPermission();
  const success = await dispatchPhoneNotification({
    title: '🔔 اختبار إشعارات الهاتف - كروتك برو',
    body: 'تهانينا! إشعارات الهاتف الحية مفعلة بنجاح وستصلك فور وصول مبيعات جديدة أو تسجيل مستخدم جديد.',
    type: 'test',
    tag: 'test-notification',
    url: '/',
  });
  return { permission: perm, success };
}

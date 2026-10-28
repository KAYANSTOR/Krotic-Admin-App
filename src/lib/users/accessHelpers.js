import { Timestamp } from 'firebase/firestore';
import { toDate, isExpired } from '../format.js';

export function hasExpiryCompatibilityGap(user) {
  const modernValue = user?.subscriptionEndsAt;
  const legacyValue = user?.subscription_end_date;
  if (modernValue == null && legacyValue == null) return false;

  const modernDate = toDate(modernValue);
  const legacyDate = toDate(legacyValue);
  return !modernDate
    || !legacyDate
    || Number.isNaN(modernDate.getTime())
    || Number.isNaN(legacyDate.getTime())
    || modernDate.getTime() !== legacyDate.getTime();
}

export function deriveActiveFromStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  if (normalized === 'SUSPENDED_GRACE' || normalized === 'LOCKED_EXPIRED') return false;
  if (normalized === 'TRIAL' || normalized === 'ACTIVE_PAID') return true;
  return undefined;
}

export function deriveTrialFromStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  if (normalized === 'TRIAL') return true;
  if (normalized === 'ACTIVE_PAID' || normalized === 'SUSPENDED_GRACE' || normalized === 'LOCKED_EXPIRED') return false;
  return undefined;
}

export function normalizeTimestampValue(value) {
  if (value == null || value === '') return null;

  try {
    if (value instanceof Timestamp) return value;
    if (typeof value?.toMillis === 'function') {
      const millis = value.toMillis();
      return Number.isFinite(millis) ? Timestamp.fromMillis(millis) : null;
    }
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? Timestamp.fromMillis(value.getTime()) : null;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? Timestamp.fromMillis(value) : null;
    }

    if (typeof value === 'string') {
      const numeric = Number(value);
      const millis = Number.isFinite(numeric) && value.trim() !== ''
        ? numeric
        : Date.parse(value);
      return Number.isFinite(millis) ? Timestamp.fromMillis(millis) : null;
    }
  } catch {
    return null;
  }

  return null;
}

export function isExpiringSoon(user, warningWindowMs) {
  const endValue = user?.subscriptionEndsAt ?? user?.subscription_end_date;
  if (endValue == null || isExpired(endValue)) return false;

  const endDate = toDate(endValue);
  if (!endDate || Number.isNaN(endDate.getTime())) return false;
  const windowMs = Number(warningWindowMs);
  if (!Number.isFinite(windowMs) || windowMs < 0) return false;

  const remainingMs = endDate.getTime() - Date.now();
  return remainingMs >= 0 && remainingMs <= windowMs;
}

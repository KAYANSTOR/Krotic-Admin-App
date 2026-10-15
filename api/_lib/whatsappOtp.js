// ============================================================
// Krotak Pro — WhatsApp OTP helpers (import-only; not a Vercel route)
// Public API routes are internally rewritten to the existing
// /api/manage-user-auth function to stay within the Hobby function limit.
// ============================================================

import {
  createHash,
  createHmac,
  randomInt as secureRandomInt,
  timingSafeEqual,
} from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { ensureFirebaseAdmin } from './firebaseAdmin.js';

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_PHONE_PER_HOUR = 5;
const MAX_REQUESTS_PER_IP_PER_HOUR = 20;
const MAX_VERIFY_ATTEMPTS = 5;
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const PHONE_INDEX_COLLECTION = 'network_registration_phone_index';
const USERS_COLLECTION = 'users';
const ADMINS_COLLECTION = 'Admins';

function normalizeBody(body) {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

/**
 * Accept international phone digits (or a leading + and common separators),
 * then normalize to digits only, matching the existing users.phone contract.
 */
export function normalizePhoneNumber(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!/^\+?[0-9][0-9\s().-]*$/.test(input)) return null;
  const digits = input.replace(/\D/g, '');
  if (!/^[1-9][0-9]{10,14}$/.test(digits)) return null;
  return digits;
}

export function getPhoneIndexId(phoneNumber) {
  return createHash('sha256').update(phoneNumber).digest('hex');
}

export function getOtpChallengeId(phoneNumber, secret) {
  return createHmac('sha256', secret)
    .update(`krotak-whatsapp-otp-id-v1\0${phoneNumber}`)
    .digest('hex');
}

export function hashOtp(phoneNumber, otp, secret) {
  return createHmac('sha256', secret)
    .update(`krotak-whatsapp-otp-v1\0${phoneNumber}\0${otp}`)
    .digest('hex');
}

function safeEqualHex(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) {
    return false;
  }
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function otpSecretFrom(env) {
  const secret = env.OTP_HASH_SECRET;
  return typeof secret === 'string' && Buffer.byteLength(secret, 'utf8') >= 32 ? secret : null;
}

function metaConfigFrom(env) {
  const token = env.META_WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = env.META_WHATSAPP_PHONE_NUMBER_ID;
  const templateName = env.META_WHATSAPP_TEMPLATE_NAME;
  const templateLanguage = env.META_WHATSAPP_TEMPLATE_LANGUAGE;
  const apiVersion = env.META_WHATSAPP_API_VERSION || 'v26.0';

  if (!token || !phoneNumberId || !templateName || !templateLanguage) return null;
  if (!/^\d{5,30}$/.test(phoneNumberId)) return null;
  if (!/^[A-Za-z0-9_]{1,512}$/.test(templateName)) return null;
  if (!/^[A-Za-z0-9_-]{2,20}$/.test(templateLanguage)) return null;
  if (!/^v\d+\.\d+$/.test(apiVersion)) return null;

  return { token, phoneNumberId, templateName, templateLanguage, apiVersion };
}

export function buildMetaOtpPayload({ phoneNumber, otp, templateName, templateLanguage }) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phoneNumber,
    type: 'template',
    template: {
      name: templateName,
      language: { code: templateLanguage },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: otp }],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: otp }],
        },
      ],
    },
  };
}

async function sendMetaOtp({ phoneNumber, otp, config, fetchImpl }) {
  const endpoint = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildMetaOtpPayload({
      phoneNumber,
      otp,
      templateName: config.templateName,
      templateLanguage: config.templateLanguage,
    })),
    signal: AbortSignal.timeout(10_000),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('WhatsApp provider rejected OTP message');
    error.status = response.status;
    error.metaCode = result?.error?.code ?? null;
    error.metaSubcode = result?.error?.error_subcode ?? null;
    throw error;
  }
  return result;
}

function clientIpFromRequest(req) {
  const headers = req?.headers || {};
  const realIp = String(headers['x-real-ip'] || '').trim();
  const forwarded = String(headers['x-forwarded-for'] || '').split(',')[0].trim();
  const candidate = realIp || forwarded;
  if (!candidate || candidate.length > 128 || /[^0-9a-fA-F:.]/.test(candidate)) return null;
  return candidate;
}

function rateKey(kind, value, secret) {
  return createHmac('sha256', secret)
    .update(`krotak-otp-rate-${kind}-v1\0${value}`)
    .digest('hex');
}

function getWindowState(record, now) {
  const storedStart = Number(record?.windowStartAtMs);
  const storedCount = Number(record?.requestCount);
  const validWindow = Number.isFinite(storedStart) && now >= storedStart && now - storedStart < RATE_WINDOW_MS;
  return {
    windowStartAtMs: validWindow ? storedStart : now,
    requestCount: validWindow && Number.isFinite(storedCount) ? storedCount : 0,
  };
}

async function reserveRateLimit(db, { phoneNumber, ip, secret, now }) {
  const phoneRef = db.collection('auth_otp_rate_limits').doc(`phone_${rateKey('phone', phoneNumber, secret)}`);
  const ipRef = ip ? db.collection('auth_otp_rate_limits').doc(`ip_${rateKey('ip', ip, secret)}`) : null;

  return db.runTransaction(async (transaction) => {
    const phoneSnapshot = await transaction.get(phoneRef);
    const ipSnapshot = ipRef ? await transaction.get(ipRef) : null;
    const phoneRecord = phoneSnapshot.exists ? phoneSnapshot.data() || {} : {};
    const ipRecord = ipSnapshot?.exists ? ipSnapshot.data() || {} : {};
    const phoneWindow = getWindowState(phoneRecord, now);
    const ipWindow = getWindowState(ipRecord, now);

    const lastSentAtMs = Number(phoneRecord.lastSentAtMs);
    if (Number.isFinite(lastSentAtMs) && now >= lastSentAtMs && now - lastSentAtMs < RESEND_COOLDOWN_MS) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((RESEND_COOLDOWN_MS - (now - lastSentAtMs)) / 1000)) };
    }
    if (phoneWindow.requestCount >= MAX_REQUESTS_PER_PHONE_PER_HOUR) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((phoneWindow.windowStartAtMs + RATE_WINDOW_MS - now) / 1000)) };
    }
    if (ipRef && ipWindow.requestCount >= MAX_REQUESTS_PER_IP_PER_HOUR) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((ipWindow.windowStartAtMs + RATE_WINDOW_MS - now) / 1000)) };
    }

    transaction.set(phoneRef, {
      windowStartAtMs: phoneWindow.windowStartAtMs,
      requestCount: phoneWindow.requestCount + 1,
      lastSentAtMs: now,
      expiresAt: Timestamp.fromMillis(now + 48 * 60 * 60 * 1000),
    });
    if (ipRef) {
      transaction.set(ipRef, {
        windowStartAtMs: ipWindow.windowStartAtMs,
        requestCount: ipWindow.requestCount + 1,
        expiresAt: Timestamp.fromMillis(now + 48 * 60 * 60 * 1000),
      });
    }
    return { allowed: true, retryAfterSeconds: 0 };
  });
}

/** Resolve the existing Firebase Auth UID without creating an account. */
export async function resolveClientUid(db, auth, phoneNumber) {
  const indexSnapshot = await db.collection(PHONE_INDEX_COLLECTION).doc(getPhoneIndexId(phoneNumber)).get();
  let uid;

  if (indexSnapshot.exists) {
    uid = indexSnapshot.data()?.uid;
    if (typeof uid !== 'string' || !UID_PATTERN.test(uid)) return null;
  } else {
    const matches = await db.collection(USERS_COLLECTION).where('phone', '==', phoneNumber).limit(2).get();
    if (matches.size !== 1 || !matches.docs?.[0]?.id) return null;
    uid = matches.docs[0].id;
    if (!UID_PATTERN.test(uid)) return null;
  }

  const [userSnapshot, adminSnapshot] = await Promise.all([
    db.collection(USERS_COLLECTION).doc(uid).get(),
    db.collection(ADMINS_COLLECTION).doc(uid).get(),
  ]);
  if (!userSnapshot.exists || adminSnapshot.exists) return null;

  const profile = userSnapshot.data() || {};
  if (profile.phone !== phoneNumber || (profile.uid && profile.uid !== uid)) return null;

  try {
    const authUser = await auth.getUser(uid);
    if (authUser.disabled) return null;
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return null;
    throw error;
  }
  return uid;
}

function resolveServices(deps) {
  if (deps.db && deps.auth) return { db: deps.db, auth: deps.auth };
  const init = ensureFirebaseAdmin();
  if (!init.ok) return { error: init.error };
  try {
    return { db: deps.db || getFirestore(), auth: deps.auth || getAuth() };
  } catch {
    return { error: 'server_not_configured' };
  }
}

function respond(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  return res.status(status).json(body);
}

function setAllowPost(res) {
  res.setHeader('Allow', 'POST');
}

function genericRequestSuccess(res) {
  return respond(res, 200, {
    success: true,
    message: 'If this number is registered, a verification code will be sent.',
  });
}

async function discardChallengeIfMatching(db, challengeRef, otpHash) {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(challengeRef);
    if (snapshot.exists && snapshot.data()?.otpHash === otpHash) transaction.delete(challengeRef);
  });
}

/** POST /api/request-otp — request a code for an existing, enabled client only. */
export async function handleRequestOtp(req, res, deps = {}) {
  if (req.method !== 'POST') {
    setAllowPost(res);
    return respond(res, 405, { success: false, error: 'method_not_allowed' });
  }

  const env = deps.env || process.env;
  const secret = otpSecretFrom(env);
  const metaConfig = metaConfigFrom(env);
  if (!secret || !metaConfig) {
    return respond(res, 503, { success: false, error: 'otp_service_not_configured' });
  }

  const input = normalizeBody(req.body);
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  if (!phoneNumber) return respond(res, 400, { success: false, error: 'phone_number_invalid' });

  const services = resolveServices(deps);
  if (services.error) return respond(res, 503, { success: false, error: services.error });

  const now = typeof deps.now === 'function' ? deps.now() : Date.now();
  const ip = clientIpFromRequest(req);
  const { db, auth } = services;

  try {
    const rateLimit = await reserveRateLimit(db, { phoneNumber, ip, secret, now });
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
      return respond(res, 429, { success: false, error: 'too_many_requests', retryAfterSeconds: rateLimit.retryAfterSeconds });
    }

    let uid = null;
    try {
      uid = await resolveClientUid(db, auth, phoneNumber);
    } catch (error) {
      // Do not reveal whether a number is registered if an internal lookup fails.
      (deps.logger || console.error)('whatsapp-otp: account lookup failed', { code: error?.code || 'lookup_error' });
      return genericRequestSuccess(res);
    }
    if (!uid) return genericRequestSuccess(res);

    const random = deps.randomInt || secureRandomInt;
    const otp = String(random(0, 1_000_000)).padStart(6, '0');
    const otpHash = hashOtp(phoneNumber, otp, secret);
    const challengeId = getOtpChallengeId(phoneNumber, secret);
    const challengeRef = db.collection('auth_otps').doc(challengeId);
    const expiresAtMs = now + OTP_TTL_MS;

    await challengeRef.set({
      uid,
      phoneHash: challengeId,
      otpHash,
      attempts: 0,
      createdAt: Timestamp.fromMillis(now),
      expiresAt: Timestamp.fromMillis(expiresAtMs),
    });

    try {
      await sendMetaOtp({
        phoneNumber,
        otp,
        config: metaConfig,
        fetchImpl: deps.fetchImpl || globalThis.fetch,
      });
    } catch (error) {
      await discardChallengeIfMatching(db, challengeRef, otpHash).catch(() => {});
      // No phone number, OTP, provider token, or provider response is logged.
      (deps.logger || console.error)('whatsapp-otp: delivery failed', {
        status: error?.status || null,
        metaCode: error?.metaCode || null,
        metaSubcode: error?.metaSubcode || null,
      });
      // Keep the public response indistinguishable from an unknown account.
    }

    return genericRequestSuccess(res);
  } catch (error) {
    (deps.logger || console.error)('whatsapp-otp: request failed', { code: error?.code || 'request_error' });
    return respond(res, 500, { success: false, error: 'otp_request_failed' });
  }
}

/** POST /api/verify-otp — consume one code and return a Firebase custom token. */
export async function handleVerifyOtp(req, res, deps = {}) {
  if (req.method !== 'POST') {
    setAllowPost(res);
    return respond(res, 405, { success: false, error: 'method_not_allowed' });
  }

  const env = deps.env || process.env;
  const secret = otpSecretFrom(env);
  if (!secret) return respond(res, 503, { success: false, error: 'otp_service_not_configured' });

  const input = normalizeBody(req.body);
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  if (!phoneNumber || typeof input.otp !== 'string' || !/^\d{6}$/.test(input.otp)) {
    return respond(res, 400, { success: false, error: 'verification_input_invalid' });
  }

  const services = resolveServices(deps);
  if (services.error) return respond(res, 503, { success: false, error: services.error });

  const { db, auth } = services;
  const now = typeof deps.now === 'function' ? deps.now() : Date.now();
  const challengeId = getOtpChallengeId(phoneNumber, secret);
  const challengeRef = db.collection('auth_otps').doc(challengeId);
  const suppliedHash = hashOtp(phoneNumber, input.otp, secret);

  try {
    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(challengeRef);
      if (!snapshot.exists) return { ok: false };

      const challenge = snapshot.data() || {};
      const expiry = typeof challenge.expiresAt?.toMillis === 'function'
        ? challenge.expiresAt.toMillis()
        : Number(challenge.expiresAt);
      if (!Number.isFinite(expiry) || expiry <= now) {
        transaction.delete(challengeRef);
        return { ok: false };
      }

      const attempts = Number.isInteger(challenge.attempts) ? challenge.attempts : 0;
      if (attempts >= MAX_VERIFY_ATTEMPTS) {
        transaction.delete(challengeRef);
        return { ok: false };
      }

      if (!safeEqualHex(challenge.otpHash, suppliedHash)) {
        if (attempts + 1 >= MAX_VERIFY_ATTEMPTS) transaction.delete(challengeRef);
        else transaction.set(challengeRef, { attempts: attempts + 1 }, { merge: true });
        return { ok: false };
      }

      if (typeof challenge.uid !== 'string' || !UID_PATTERN.test(challenge.uid)) {
        transaction.delete(challengeRef);
        return { ok: false };
      }

      // Consume atomically so a concurrent request cannot reuse this OTP.
      transaction.delete(challengeRef);
      return { ok: true, uid: challenge.uid };
    });

    if (!result.ok) return respond(res, 401, { success: false, error: 'otp_invalid_or_expired' });

    // Re-check the account-to-phone mapping at verification time before minting a token.
    const currentUid = await resolveClientUid(db, auth, phoneNumber);
    if (!currentUid || currentUid !== result.uid) {
      return respond(res, 401, { success: false, error: 'otp_invalid_or_expired' });
    }

    const customToken = await auth.createCustomToken(result.uid);
    return respond(res, 200, { success: true, customToken, uid: result.uid });
  } catch (error) {
    (deps.logger || console.error)('whatsapp-otp: verify failed', { code: error?.code || 'verify_error' });
    return respond(res, 500, { success: false, error: 'otp_verification_failed' });
  }
}

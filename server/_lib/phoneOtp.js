// ============================================================
// Krotak Pro — Twilio Verify SMS phone-verification helpers
// Import-only module; public routes are rewritten to the existing
// /api/manage-user-auth Vercel function to stay within the Hobby limit.
// ============================================================
import { createHash, createHmac } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { ensureFirebaseAdmin } from './firebaseAdmin.js';

const RATE_WINDOW_MS = 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_REQUESTS_PER_PHONE_PER_HOUR = 5;
const MAX_REQUESTS_PER_IP_PER_HOUR = 20;
const MAX_VERIFY_ATTEMPTS_PER_PHONE_PER_HOUR = 10;
const MAX_VERIFY_ATTEMPTS_PER_IP_PER_HOUR = 40;
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

/** Accept a phone number and normalize it to digits, matching users.phone. */
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

function otpSecretFrom(env) {
  const secret = env.OTP_HASH_SECRET;
  return typeof secret === 'string' && Buffer.byteLength(secret, 'utf8') >= 32
    ? secret
    : null;
}

function twilioConfigFrom(env) {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const serviceSid = env.TWILIO_VERIFY_SERVICE_SID;
  const apiKeySid = env.TWILIO_API_KEY_SID;
  const apiKeySecret = env.TWILIO_API_KEY_SECRET;
  const authToken = env.TWILIO_AUTH_TOKEN;
  if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid || '')
    || !/^VA[0-9a-fA-F]{32}$/.test(serviceSid || '')) return null;

  // API keys are preferred for production. Account SID + Auth Token remain
  // supported for Twilio projects that have not provisioned an API key.
  if (/^SK[0-9a-fA-F]{32}$/.test(apiKeySid || '')
    && typeof apiKeySecret === 'string' && apiKeySecret.length > 0) {
    return { accountSid, serviceSid, username: apiKeySid, password: apiKeySecret };
  }
  if (typeof authToken === 'string' && authToken.length > 0) {
    return { accountSid, serviceSid, username: accountSid, password: authToken };
  }
  return null;
}

function rateLimitKey(kind, value, secret) {
  return createHmac('sha256', secret)
    .update(`krotak-twilio-otp-rate-${kind}-v1\0${value}`)
    .digest('hex');
}

function getWindowState(record, now) {
  const storedStart = Number(record?.windowStartAtMs);
  const storedCount = Number(record?.requestCount);
  const validWindow = Number.isFinite(storedStart)
    && now >= storedStart
    && now - storedStart < RATE_WINDOW_MS;
  return {
    windowStartAtMs: validWindow ? storedStart : now,
    requestCount: validWindow && Number.isFinite(storedCount) ? storedCount : 0,
  };
}

async function reserveRateLimit(db, {
  kind,
  phoneNumber,
  ip,
  secret,
  now,
  maxPhone,
  maxIp,
  cooldownMs = 0,
}) {
  const phoneRef = db.collection('auth_otp_rate_limits')
    .doc(`phone_${rateLimitKey(`${kind}-phone`, phoneNumber, secret)}`);
  const ipRef = ip
    ? db.collection('auth_otp_rate_limits')
      .doc(`ip_${rateLimitKey(`${kind}-ip`, ip, secret)}`)
    : null;

  return db.runTransaction(async (transaction) => {
    const phoneSnapshot = await transaction.get(phoneRef);
    const ipSnapshot = ipRef ? await transaction.get(ipRef) : null;
    const phoneRecord = phoneSnapshot.exists ? phoneSnapshot.data() || {} : {};
    const ipRecord = ipSnapshot?.exists ? ipSnapshot.data() || {} : {};
    const phoneWindow = getWindowState(phoneRecord, now);
    const ipWindow = getWindowState(ipRecord, now);
    const lastSentAtMs = Number(phoneRecord.lastSentAtMs);

    if (cooldownMs > 0 && Number.isFinite(lastSentAtMs)
      && now >= lastSentAtMs && now - lastSentAtMs < cooldownMs) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((cooldownMs - (now - lastSentAtMs)) / 1000)),
      };
    }
    if (phoneWindow.requestCount >= maxPhone) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((phoneWindow.windowStartAtMs + RATE_WINDOW_MS - now) / 1000)),
      };
    }
    if (ipRef && ipWindow.requestCount >= maxIp) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((ipWindow.windowStartAtMs + RATE_WINDOW_MS - now) / 1000)),
      };
    }

    transaction.set(phoneRef, {
      windowStartAtMs: phoneWindow.windowStartAtMs,
      requestCount: phoneWindow.requestCount + 1,
      ...(cooldownMs > 0 ? { lastSentAtMs: now } : {}),
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
  const indexSnapshot = await db.collection(PHONE_INDEX_COLLECTION)
    .doc(getPhoneIndexId(phoneNumber)).get();
  let uid;
  if (indexSnapshot.exists) {
    uid = indexSnapshot.data()?.uid;
    if (typeof uid !== 'string' || !UID_PATTERN.test(uid)) return null;
  } else {
    const matches = await db.collection(USERS_COLLECTION)
      .where('phone', '==', phoneNumber).limit(2).get();
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

function isPhoneVerificationPending(profile) {
  const verified = profile?.phone_verified === true
    || profile?.phoneVerified === true
    || profile?.phone_verified_manual === true;
  return profile?.phone_verification_required === true && !verified;
}

function clientIpFromRequest(req) {
  const headers = req?.headers || {};
  const realIp = String(headers['x-real-ip'] || '').trim();
  const forwarded = String(headers['x-forwarded-for'] || '').split(',')[0].trim();
  const candidate = realIp || forwarded;
  if (!candidate || candidate.length > 128 || /[^0-9a-fA-F:.]/.test(candidate)) return null;
  return candidate;
}

async function callTwilio({ config, resource, fields, fetchImpl }) {
  const endpoint = `https://verify.twilio.com/v2/Services/${config.serviceSid}/${resource}`;
  const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('Twilio Verify request failed');
    error.status = response.status;
    error.twilioCode = Number.isInteger(result?.code) ? result.code : null;
    throw error;
  }
  return result;
}

/** POST /api/request-otp — request an SMS code for a new pending registration. */
export async function handleRequestOtp(req, res, deps = {}) {
  if (req.method !== 'POST') {
    setAllowPost(res);
    return respond(res, 405, { success: false, error: 'method_not_allowed' });
  }
  const env = deps.env || process.env;
  const secret = otpSecretFrom(env);
  const config = twilioConfigFrom(env);
  if (!secret || !config) {
    return respond(res, 503, { success: false, error: 'otp_service_not_configured' });
  }
  const input = normalizeBody(req.body);
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  if (!phoneNumber) return respond(res, 400, { success: false, error: 'phone_number_invalid' });
  const services = resolveServices(deps);
  if (services.error) return respond(res, 503, { success: false, error: services.error });

  const now = typeof deps.now === 'function' ? deps.now() : Date.now();
  const { db, auth } = services;
  const ip = clientIpFromRequest(req);
  try {
    const rateLimit = await reserveRateLimit(db, {
      kind: 'send', phoneNumber, ip, secret, now,
      maxPhone: MAX_REQUESTS_PER_PHONE_PER_HOUR,
      maxIp: MAX_REQUESTS_PER_IP_PER_HOUR,
      cooldownMs: RESEND_COOLDOWN_MS,
    });
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
      return respond(res, 429, {
        success: false,
        error: 'too_many_requests',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
    }

    let uid = null;
    try {
      uid = await resolveClientUid(db, auth, phoneNumber);
    } catch (error) {
      // Keep registered and unknown numbers indistinguishable to callers.
      (deps.logger || console.error)('sms-otp: account lookup failed', {
        code: error?.code || 'lookup_error',
      });
      return genericRequestSuccess(res);
    }
    if (!uid) return genericRequestSuccess(res);

    const userSnapshot = await db.collection(USERS_COLLECTION).doc(uid).get();
    if (!isPhoneVerificationPending(userSnapshot.data() || {})) {
      return genericRequestSuccess(res);
    }

    try {
      await callTwilio({
        config,
        resource: 'Verifications',
        fields: {
          To: `+${phoneNumber}`,
          // Use Twilio's WhatsApp sender by default; SMS remains an explicit opt-in fallback.
          Channel: env.TWILIO_VERIFY_CHANNEL === 'sms' ? 'sms' : 'whatsapp',
        },
        fetchImpl: deps.fetchImpl || globalThis.fetch,
      });
    } catch (error) {
      // Never log recipient, OTP, credentials, or provider response body.
      (deps.logger || console.error)('sms-otp: Twilio delivery failed', {
        status: error?.status || null,
        code: error?.twilioCode || null,
      });
    }
    // Same response for known/unknown clients and provider delivery failures.
    return genericRequestSuccess(res);
  } catch (error) {
    (deps.logger || console.error)('sms-otp: request failed', {
      code: error?.code || 'request_error',
    });
    return respond(res, 500, { success: false, error: 'otp_request_failed' });
  }
}

/** POST /api/verify-otp — verify through Twilio and mint a Firebase custom token. */
export async function handleVerifyOtp(req, res, deps = {}) {
  if (req.method !== 'POST') {
    setAllowPost(res);
    return respond(res, 405, { success: false, error: 'method_not_allowed' });
  }
  const env = deps.env || process.env;
  const secret = otpSecretFrom(env);
  const config = twilioConfigFrom(env);
  if (!secret || !config) {
    return respond(res, 503, { success: false, error: 'otp_service_not_configured' });
  }
  const input = normalizeBody(req.body);
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  if (!phoneNumber || typeof input.otp !== 'string' || !/^\d{6}$/.test(input.otp)) {
    return respond(res, 400, { success: false, error: 'verification_input_invalid' });
  }
  const services = resolveServices(deps);
  if (services.error) return respond(res, 503, { success: false, error: services.error });

  const now = typeof deps.now === 'function' ? deps.now() : Date.now();
  const { db, auth } = services;
  try {
    const rateLimit = await reserveRateLimit(db, {
      kind: 'verify',
      phoneNumber,
      ip: clientIpFromRequest(req),
      secret,
      now,
      maxPhone: MAX_VERIFY_ATTEMPTS_PER_PHONE_PER_HOUR,
      maxIp: MAX_VERIFY_ATTEMPTS_PER_IP_PER_HOUR,
    });
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
      return respond(res, 429, {
        success: false,
        error: 'too_many_requests',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
    }

    let verification;
    try {
      verification = await callTwilio({
        config,
        resource: 'VerificationCheck',
        fields: { To: `+${phoneNumber}`, Code: input.otp },
        fetchImpl: deps.fetchImpl || globalThis.fetch,
      });
    } catch (error) {
      if (error?.status === 400 || error?.status === 404) {
        return respond(res, 401, { success: false, error: 'otp_invalid_or_expired' });
      }
      if (error?.status === 429) {
        res.setHeader('Retry-After', '60');
        return respond(res, 429, { success: false, error: 'too_many_requests' });
      }
      (deps.logger || console.error)('sms-otp: Twilio verification failed', {
        status: error?.status || null,
        code: error?.twilioCode || null,
      });
      return respond(res, 503, { success: false, error: 'otp_verification_unavailable' });
    }
    if (verification.status !== 'approved') {
      return respond(res, 401, { success: false, error: 'otp_invalid_or_expired' });
    }

    const uid = await resolveClientUid(db, auth, phoneNumber);
    if (!uid) return respond(res, 401, { success: false, error: 'otp_invalid_or_expired' });
    const userRef = db.collection(USERS_COLLECTION).doc(uid);
    const userSnapshot = await userRef.get();
    if (!isPhoneVerificationPending(userSnapshot.data() || {})) {
      return respond(res, 401, { success: false, error: 'otp_invalid_or_expired' });
    }
    await userRef.set({
      phone_verified: true,
      phoneVerified: true,
      phone_verified_sms: true,
      phone_verified_at: Timestamp.fromMillis(now),
      phone_verification_required: false,
    }, { merge: true });
    const customToken = await auth.createCustomToken(uid);
    return respond(res, 200, { success: true, customToken, uid });
  } catch (error) {
    (deps.logger || console.error)('sms-otp: verify failed', {
      code: error?.code || 'verify_error',
    });
    return respond(res, 500, { success: false, error: 'otp_verification_failed' });
  }
}

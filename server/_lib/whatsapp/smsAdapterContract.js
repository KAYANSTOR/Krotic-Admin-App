/**
 * SMS fallback integration contract — NO provider invented.
 *
 * Existing repo uses SMS only for:
 *  - template-center outbound templates (device-side parsing context)
 *  - phone OTP via Twilio Verify (optional env) — NOT for card delivery
 *  - sale status SMS_PENDING labels in UI
 *
 * There is NO existing outbound SMS engine for card PIN delivery.
 *
 * Required before enabling real SMS fallback:
 *  1. Owner chooses provider (Twilio Messaging API, Unifonic, local modem gateway, …)
 *  2. Env: SMS_PROVIDER + credentials (never in client)
 *  3. Adapter implementing sendSms({ idempotencyKey, toE164, body }) →
 *       { ok, providerMessageId?, error?, classification? }
 *  4. Provider MUST accept Idempotency-Key OR we keep at-most-once via smsOutcomeUnknown
 *
 * Until then: executeSmsFallbackPipeline uses simulateAccept only in tests;
 * production path returns sms_provider_not_configured.
 */

export const SMS_CARD_DELIVERY_CONTRACT = Object.freeze({
  purpose: 'whatsapp_deadline_fallback_card_text',
  identity: 'deliveryOperationId = networkId__saleUuid',
  idempotencyKeyFormat: 'krotak-wa-sms:{deliveryOperationId}',
  requiredEnv: ['SMS_PROVIDER', 'SMS_API_KEY_OR_EQUIVALENT'],
  existingRepoEngines: {
    twilio_verify_otp: 'server/_lib/phoneOtp.js — OTP only, not card delivery',
    template_outbound: 'template center — device templates, not server send',
  },
  missing: [
    'outbound SMS adapter for card body',
    'owner decision on provider',
    'production credentials',
  ],
  outcomeUnknownPolicy: 'never auto-resend; admin review only',
});

/**
 * Resolve adapter from env — always null until configured.
 */
export function resolveSmsCardAdapter(dependencies = {}) {
  if (typeof dependencies.sendSms === 'function') {
    return { ok: true, adapter: dependencies.sendSms, source: 'injected' };
  }
  const provider = process.env.SMS_PROVIDER;
  if (!provider) {
    return {
      ok: false,
      error: 'sms_provider_not_configured',
      contract: SMS_CARD_DELIVERY_CONTRACT,
    };
  }
  // Explicit: do not invent Twilio Messaging / Unifonic clients here.
  return {
    ok: false,
    error: 'sms_provider_adapter_not_implemented',
    provider,
    contract: SMS_CARD_DELIVERY_CONTRACT,
    note: 'Provider name set but no server adapter module registered for card delivery',
  };
}

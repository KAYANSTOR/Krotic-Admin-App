/**
 * Secret access boundary for WhatsApp.
 * Production path: Google Secret Manager.
 * Until GCP/IAM is verified ready, accessors return not_configured — never invent secrets.
 */

export const SECRETS_BACKEND = {
  /** @type {'secret_manager' | 'not_configured'} */
  mode: process.env.WHATSAPP_SECRETS_BACKEND === 'secret_manager' ? 'secret_manager' : 'not_configured',
};

/**
 * @returns {Promise<{ ok: true, value: string } | { ok: false, error: string }>}
 */
export async function getMetaAppSecret() {
  if (SECRETS_BACKEND.mode !== 'secret_manager') {
    // Dev-only escape hatch: WHATSAPP_META_APP_SECRET for unit tests / local emulator — never in client.
    if (process.env.WHATSAPP_META_APP_SECRET && process.env.NODE_ENV !== 'production') {
      return { ok: true, value: process.env.WHATSAPP_META_APP_SECRET };
    }
    return { ok: false, error: 'secret_manager_not_configured' };
  }
  // Hook for future Secret Manager client — not implemented until IAM verified.
  return { ok: false, error: 'secret_manager_client_not_wired' };
}

export async function getMetaVerifyToken() {
  if (SECRETS_BACKEND.mode !== 'secret_manager') {
    if (process.env.WHATSAPP_META_VERIFY_TOKEN && process.env.NODE_ENV !== 'production') {
      return { ok: true, value: process.env.WHATSAPP_META_VERIFY_TOKEN };
    }
    return { ok: false, error: 'secret_manager_not_configured' };
  }
  return { ok: false, error: 'secret_manager_client_not_wired' };
}

/** Per-network access token — never returned to clients. */
export async function getNetworkMetaAccessToken(networkId) {
  if (!networkId) return { ok: false, error: 'network_id_required' };
  if (SECRETS_BACKEND.mode !== 'secret_manager') {
    return { ok: false, error: 'secret_manager_not_configured' };
  }
  return { ok: false, error: 'secret_manager_client_not_wired' };
}

export async function getDispatchServiceSecret() {
  if (process.env.WHATSAPP_DISPATCH_SERVICE_SECRET) {
    return { ok: true, value: process.env.WHATSAPP_DISPATCH_SERVICE_SECRET };
  }
  if (SECRETS_BACKEND.mode !== 'secret_manager') {
    return { ok: false, error: 'dispatch_secret_not_configured' };
  }
  return { ok: false, error: 'secret_manager_client_not_wired' };
}

export function secretsReadinessReport() {
  return {
    backend: SECRETS_BACKEND.mode,
    metaAppSecret: SECRETS_BACKEND.mode === 'secret_manager' ? 'pending_wire' : 'not_configured',
    metaVerifyToken: SECRETS_BACKEND.mode === 'secret_manager' ? 'pending_wire' : 'not_configured',
    networkAccessTokens: SECRETS_BACKEND.mode === 'secret_manager' ? 'pending_wire' : 'not_configured',
    dispatchServiceSecret: process.env.WHATSAPP_DISPATCH_SERVICE_SECRET ? 'env_present' : 'not_configured',
    cloudTasks: 'not_verified',
    cloudScheduler: 'not_verified',
  };
}

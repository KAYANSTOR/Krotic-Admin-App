const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const TEMPLATE_ID_KINDS = new Set([
  'phone',
  'alternativeNumber',
  'account',
  'senderNameOnly',
  'balanceRequestCode',
]);
const TEMPLATE_PLACEHOLDERS = new Set(['amount', 'phone', 'account', 'ref', 'qty', 'dest']);
const FLEXIBLE_SEPARATORS = new Set([':', '-', '/', ',', '.', '،']);
const MAX_COLLECTION_ITEMS = 250;
const MAX_PAYLOAD_BYTES = 700_000;
const VARIABLE_SCOPE = Object.freeze({
  outboundCustomer: 'outboundCustomer',
  outboundPos: 'outboundPos',
  outboundSystem: 'outboundSystem',
});

export function getTemplateCenterCatalog() {
  return {
    identifierKinds: [...TEMPLATE_ID_KINDS],
    outboundTemplates: Object.entries(OUTBOUND_TEMPLATES).map(([key, definition]) => ({
      key,
      scope: definition.scope,
      required: [...definition.required],
    })),
    outboundVariables: Object.keys(VARIABLE_ALIASES),
    inboundPlaceholders: [...TEMPLATE_PLACEHOLDERS],
  };
}

const OUTBOUND_TEMPLATES = Object.freeze({
  voucher_delivery_sms_template: { scope: VARIABLE_SCOPE.outboundCustomer, required: ['secret'] },
  pos_customer_card_delivery_template: { scope: VARIABLE_SCOPE.outboundCustomer, required: ['cards'] },
  customer_debt_payment_template: { scope: VARIABLE_SCOPE.outboundCustomer, required: ['amount'] },
  pos_order_success_template: { scope: VARIABLE_SCOPE.outboundPos, required: ['quantity_text'] },
  pos_customer_sms_tail_template: { scope: VARIABLE_SCOPE.outboundPos, required: [] },
  pos_balance_response_template: { scope: VARIABLE_SCOPE.outboundPos, required: ['pos_name'] },
  pos_credit_limit_exceeded_template: { scope: VARIABLE_SCOPE.outboundPos, required: ['pos_name'] },
  pos_request_rejected_template: { scope: VARIABLE_SCOPE.outboundPos, required: ['pos_name'] },
  pos_instant_charge_confirm_template: { scope: VARIABLE_SCOPE.outboundPos, required: ['amount', 'customer_phone'] },
  daily_pos_summary_template: { scope: VARIABLE_SCOPE.outboundPos, required: ['pos_name'] },
  pos_settlement_template_success: { scope: VARIABLE_SCOPE.outboundPos, required: ['pos_name', 'amount'] },
  pos_settlement_template_failed: { scope: VARIABLE_SCOPE.outboundPos, required: ['pos_name'] },
  pos_settlement_template_unknown: { scope: VARIABLE_SCOPE.outboundPos, required: ['pos_name'] },
  promotion_reward_sms_template: { scope: VARIABLE_SCOPE.outboundCustomer, required: ['serial'] },
  salafni_template_accepted: { scope: VARIABLE_SCOPE.outboundCustomer, required: ['amount'] },
  salafni_template_rejected: { scope: VARIABLE_SCOPE.outboundCustomer, required: ['reason'] },
  salafni_template_settled: { scope: VARIABLE_SCOPE.outboundCustomer, required: ['amount'] },
  low_stock_alert_template: { scope: VARIABLE_SCOPE.outboundSystem, required: ['category'] },
});

const VARIABLE_ALIASES = Object.freeze({
  serial: ['serial_number', 'CARD_SERIAL', 'CARD_CODE', 'الرقم'],
  secret: ['code', 'CODE', 'SECRET', 'الرمز'],
  card_value: ['CARD_VALUE', 'الفئة'],
  category: ['category_name'],
  network_name: ['NETWORK_NAME', 'network', 'اسم_المحفظة'],
  customer_phone: ['phone', 'CUSTOMER_PHONE', 'destination'],
  notify_phone: ['NOTIFY_PHONE'],
  pos_name: ['pos', 'POS_NAME'],
  pos_id: [],
  identifier: [],
  amount: ['AMOUNT', 'المبلغ', 'SETTLEMENT_AMOUNT', 'reward_value'],
  total: ['TOTAL'],
  paid: [],
  surplus: [],
  balance: [],
  debt: [],
  remaining: ['REMAINING_BALANCE'],
  limit: [],
  sales: [],
  transfers: [],
  quantity: ['QUANTITY'],
  quantity_text: ['QUANTITY_TEXT'],
  count: [],
  cards: ['CARDS'],
  currency: ['CURRENCY'],
  customer_name: [],
  first_customer_name: ['اسم_الزبون_الاول'],
  promotion_name: ['title'],
  reason: [],
  user: ['المستخدم'],
});

const VARIABLE_SCOPES = Object.freeze({
  serial: ['outboundCustomer', 'outboundPos', 'outboundSystem'],
  secret: ['outboundCustomer', 'outboundPos', 'outboundSystem'],
  card_value: ['outboundCustomer', 'outboundPos', 'outboundSystem'],
  category: ['outboundCustomer', 'outboundPos', 'outboundSystem'],
  network_name: ['outboundCustomer', 'outboundPos', 'outboundSystem'],
  customer_phone: ['outboundCustomer', 'outboundPos', 'outboundSystem'],
  notify_phone: ['outboundPos', 'outboundSystem'],
  pos_name: ['outboundCustomer', 'outboundPos', 'outboundSystem'],
  pos_id: ['outboundPos'],
  identifier: ['outboundPos'],
  amount: ['outboundCustomer', 'outboundPos', 'outboundSystem'],
  total: ['outboundPos'],
  paid: ['outboundCustomer', 'outboundSystem'],
  surplus: ['outboundCustomer', 'outboundSystem'],
  balance: ['outboundCustomer', 'outboundPos', 'outboundSystem'],
  debt: ['outboundPos'],
  remaining: ['outboundPos'],
  limit: ['outboundPos'],
  sales: ['outboundPos'],
  transfers: ['outboundPos'],
  quantity: ['outboundCustomer', 'outboundPos'],
  quantity_text: ['outboundCustomer', 'outboundPos'],
  count: ['outboundSystem'],
  cards: ['outboundCustomer', 'outboundPos'],
  currency: ['outboundCustomer', 'outboundPos', 'outboundSystem'],
  customer_name: ['outboundCustomer', 'outboundSystem'],
  first_customer_name: ['outboundSystem'],
  promotion_name: ['outboundCustomer'],
  reason: ['outboundCustomer', 'outboundPos', 'outboundSystem'],
  user: ['outboundCustomer', 'outboundSystem'],
  ref: ['inboundWalletParse', 'inboundPosParse'],
  qty: ['inboundPosParse'],
  dest: ['inboundPosParse'],
  account: ['inboundWalletParse', 'inboundPosParse'],
});

const CANONICAL_VARIABLE_BY_ALIAS = new Map();
for (const [canonical, aliases] of Object.entries(VARIABLE_ALIASES)) {
  CANONICAL_VARIABLE_BY_ALIAS.set(canonical, canonical);
  aliases.forEach((alias) => CANONICAL_VARIABLE_BY_ALIAS.set(alias, canonical));
}
for (const placeholder of TEMPLATE_PLACEHOLDERS) {
  CANONICAL_VARIABLE_BY_ALIAS.set(placeholder, placeholder);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isText(value, max) {
  return typeof value === 'string' && value.length <= max;
}

function normalizeScope(scope) {
  if (!isRecord(scope) || !['global', 'network'].includes(scope.type)) return null;
  if (scope.type === 'global') {
    return { type: 'global', networkId: null };
  }
  if (typeof scope.networkId !== 'string' || !SAFE_ID.test(scope.networkId)) return null;
  return { type: 'network', networkId: scope.networkId };
}

function templatePlaceholders(text) {
  const keys = [];
  const matcher = /\{([^{}]+)\}|%([A-Za-z][A-Za-z0-9_]*)/gu;
  for (const match of text.matchAll(matcher)) keys.push(match[1] ?? match[2]);
  return keys;
}

function canonicalVariable(key) {
  return CANONICAL_VARIABLE_BY_ALIAS.get(key.trim()) ?? null;
}

function validateWallet(wallet, index, errors, { allowDrafts }) {
  const at = `wallets[${index}]`;
  if (!isRecord(wallet)) {
    errors.push(`${at}_invalid`);
    return;
  }
  if (typeof wallet.id !== 'string' || !SAFE_ID.test(wallet.id)) errors.push(`${at}_id_invalid`);
  if (!isText(wallet.name, 120) || !wallet.name.trim()) errors.push(`${at}_name_invalid`);
  if (!['active', 'suspended', 'archived'].includes(wallet.status)) errors.push(`${at}_status_invalid`);
  if (!['sms', 'notification'].includes(wallet.sourceMode ?? 'sms')) errors.push(`${at}_source_mode_invalid`);
  if (wallet.senderId != null && !isText(wallet.senderId, 120)) errors.push(`${at}_sender_id_invalid`);
  if (wallet.packageName != null && !isText(wallet.packageName, 200)) errors.push(`${at}_package_name_invalid`);
  if (!allowDrafts && wallet.sourceMode === 'notification' && !String(wallet.packageName ?? '').trim()) {
    errors.push(`${at}_package_name_required_for_notification`);
  }
  if (!allowDrafts && (wallet.createdAt == null || !Number.isFinite(Date.parse(wallet.createdAt)))) {
    errors.push(`${at}_created_at_invalid`);
  }
}

function validateInboundTemplate(template, index, walletIds, errors, { allowDrafts }) {
  const at = `transferTemplates[${index}]`;
  if (!isRecord(template)) {
    errors.push(`${at}_invalid`);
    return;
  }
  if (typeof template.id !== 'string' || !SAFE_ID.test(template.id)) errors.push(`${at}_id_invalid`);
  if (!isText(template.name, 120) || !template.name.trim()) errors.push(`${at}_name_invalid`);
  if (!isText(template.pattern, 500) || !template.pattern.trim()) errors.push(`${at}_pattern_invalid`);
  if (template.sampleBody != null && !isText(template.sampleBody, 2000)) errors.push(`${at}_sample_body_invalid`);
  if (template.senderCode != null && !isText(template.senderCode, 120)) errors.push(`${at}_sender_code_invalid`);
  if (template.walletId != null && (!SAFE_ID.test(template.walletId) || !walletIds.has(template.walletId))) {
    errors.push(`${at}_wallet_id_invalid`);
  }
  if (template.posId != null && (typeof template.posId !== 'string' || !SAFE_ID.test(template.posId))) {
    errors.push(`${at}_pos_id_invalid`);
  }
  if (!Number.isInteger(template.priority) || template.priority < 0 || template.priority > 9999) {
    errors.push(`${at}_priority_invalid`);
  }
  if (!TEMPLATE_ID_KINDS.has(template.identifierKind)) errors.push(`${at}_identifier_kind_invalid`);
  if (typeof template.isActive !== 'boolean') errors.push(`${at}_is_active_invalid`);
  if (template.requireReference != null && typeof template.requireReference !== 'boolean') {
    errors.push(`${at}_require_reference_invalid`);
  }
  if (template.senderNameLabel != null && !isText(template.senderNameLabel, 120)) {
    errors.push(`${at}_sender_name_label_invalid`);
  }
  if (template.noteLabel != null && !isText(template.noteLabel, 120)) errors.push(`${at}_note_label_invalid`);

  const source = String(template.pattern ?? '');
  const normalized = source.replace(/%(amount|phone|account|ref|qty|dest)\b/g, '{$1}');
  const tokens = templatePlaceholders(normalized);
  const allowed = new Set([...TEMPLATE_PLACEHOLDERS]);
  if (!allowDrafts) {
    if (tokens.some((token) => !allowed.has(token))) errors.push(`${at}_placeholder_unknown`);
    if (/\{[^{}]*\}/u.test(normalized.replace(/\{(?:amount|phone|account|ref|qty|dest)\}/gu, ''))) {
      errors.push(`${at}_placeholder_unknown`);
    }
    const tokenSet = new Set(tokens);
    if (template.identifierKind !== 'balanceRequestCode' && !tokenSet.has('amount')) {
      errors.push(`${at}_required_amount_missing`);
    }
    const identifierToken = ['phone', 'alternativeNumber'].includes(template.identifierKind)
      ? 'phone'
      : template.identifierKind === 'account' ? 'account' : null;
    if (identifierToken && !tokenSet.has(identifierToken)) errors.push(`${at}_required_identifier_missing`);
    if (template.requireReference && template.identifierKind !== 'balanceRequestCode' && !tokenSet.has('ref')) {
      errors.push(`${at}_required_reference_missing`);
    }
    if (template.isActive && !template.walletId && !template.posId
        && template.identifierKind !== 'balanceRequestCode') {
      errors.push(`${at}_active_scope_required`);
    }
  }
}

function validateOutboundTemplate(template, index, errors, { allowDrafts }) {
  const at = `outboundTemplates[${index}]`;
  if (!isRecord(template)) {
    errors.push(`${at}_invalid`);
    return;
  }
  const definition = OUTBOUND_TEMPLATES[template.key];
  if (!definition) {
    errors.push(`${at}_key_unknown`);
    return;
  }
  if (!isText(template.body, 2000) || !template.body.trim()) errors.push(`${at}_body_invalid`);
  if (allowDrafts) return;
  const occurrences = templatePlaceholders(String(template.body ?? ''));
  const canonicalKeys = occurrences.map(canonicalVariable);
  if (canonicalKeys.some((key) => key == null)) errors.push(`${at}_variable_unknown`);
  const repeated = new Set();
  const seen = new Set();
  canonicalKeys.filter(Boolean).forEach((key) => {
    if (seen.has(key)) repeated.add(key);
    seen.add(key);
  });
  if (repeated.size) errors.push(`${at}_variable_duplicate`);
  if (canonicalKeys.some((key) => key && !VARIABLE_SCOPES[key]?.includes(definition.scope))) {
    errors.push(`${at}_variable_scope_invalid`);
  }
  const requiredCanonical = definition.required.map(canonicalVariable);
  if (requiredCanonical.some((key) => !seen.has(key))) errors.push(`${at}_required_variable_missing`);
}

export function validateTemplatePayload(payload, { allowDrafts = true } = {}) {
  const errors = [];
  if (!isRecord(payload)) return { ok: false, errors: ['payload_invalid'] };
  const wallets = payload.wallets ?? [];
  const transferTemplates = payload.transferTemplates ?? [];
  const outboundTemplates = payload.outboundTemplates ?? [];
  for (const [name, list] of Object.entries({ wallets, transferTemplates, outboundTemplates })) {
    if (!Array.isArray(list) || list.length > MAX_COLLECTION_ITEMS) errors.push(`${name}_invalid`);
  }
  if (errors.length) return { ok: false, errors };

  const walletIds = new Set();
  wallets.forEach((wallet, index) => {
    validateWallet(wallet, index, errors, { allowDrafts });
    if (typeof wallet?.id === 'string') {
      if (walletIds.has(wallet.id)) errors.push(`wallets[${index}]_id_duplicate`);
      walletIds.add(wallet.id);
    }
  });
  const templateIds = new Set();
  transferTemplates.forEach((template, index) => {
    validateInboundTemplate(template, index, walletIds, errors, { allowDrafts });
    if (typeof template?.id === 'string') {
      if (templateIds.has(template.id)) errors.push(`transferTemplates[${index}]_id_duplicate`);
      templateIds.add(template.id);
    }
  });
  const outboundKeys = new Set();
  outboundTemplates.forEach((template, index) => {
    validateOutboundTemplate(template, index, errors, { allowDrafts });
    if (typeof template?.key === 'string') {
      if (outboundKeys.has(template.key)) errors.push(`outboundTemplates[${index}]_key_duplicate`);
      outboundKeys.add(template.key);
    }
  });

  const serializedBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (serializedBytes > MAX_PAYLOAD_BYTES) errors.push('payload_too_large');
  if (!allowDrafts) {
    const activeWallets = new Set(wallets.filter((wallet) => wallet.status === 'active').map((wallet) => wallet.id));
    transferTemplates.forEach((template, index) => {
      if (!template?.isActive) return;
      if (template.walletId && !activeWallets.has(template.walletId)) {
        errors.push(`transferTemplates[${index}]_wallet_not_active`);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

function normalizeDigits(input) {
  return input.replace(/[٠-٩۰-۹]/gu, (digit) => {
    const code = digit.codePointAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    return String(code - 0x06f0);
  });
}

function normalizeMessage(input) {
  return normalizeDigits(String(input ?? '').trim())
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '')
    .replace(/\u00a0/gu, ' ')
    .replace(/[\u064b-\u065f\u0670\u06d6-\u06ed]/gu, '')
    .replace(/\u0640/gu, '')
    .replace(/[\u0622\u0623\u0625\u0627\u0671]/gu, '\u0627')
    .replace(/\u0649/gu, '\u064a')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\s*\n\s*/gu, ' ')
    .trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function buildInboundPatternRegex(pattern, { allowImplicitPosQuantity = false } = {}) {
  const unified = normalizeMessage(pattern)
    .replace(/%(amount|phone|account|ref|qty|dest)\b/gu, '{$1}');
  let source = '';
  const groups = new Set();
  for (let index = 0; index < unified.length;) {
    const token = [...TEMPLATE_PLACEHOLDERS].find((name) => unified.startsWith(`{${name}}`, index));
    if (token) {
      if (groups.has(token)) throw new Error('duplicate_placeholder');
      groups.add(token);
      const capture = {
        amount: '(?<amount>[\\d]+(?:[.,]\\d{1,2})?)',
        phone: '(?<phone>\\+?[\\d]{7,15})',
        account: '(?<account>.+?)',
        ref: '(?<ref>\\S{1,64})',
        qty: '(?<qty>\\d{1,2})',
        dest: '(?<dest>\\+?[\\d]{7,15})',
      }[token];
      source += capture;
      index += token.length + 2;
      continue;
    }
    const character = unified[index];
    if (FLEXIBLE_SEPARATORS.has(character)) {
      source += `\\s*${escapeRegex(character)}\\s*`;
    } else if (character === ' ' || character === '\t' || character === '\n') {
      source += '\\s*';
      while (index + 1 < unified.length && [' ', '\t', '\n'].includes(unified[index + 1])) index += 1;
    } else {
      source += escapeRegex(character);
    }
    index += 1;
  }
  if (allowImplicitPosQuantity && !groups.has('qty')) source += '(?:\\s+(?<qty>\\d{1,2}))?';
  return new RegExp(`^${source}$`, 'iu');
}

function isPhone(value) {
  const digits = String(value ?? '').replace(/\D/gu, '');
  return digits.length >= 7 && digits.length <= 15;
}

export function simulateInboundTemplates(payload, { body, sender = '' }) {
  const input = normalizeMessage(body);
  if (!input) return { matched: false, reason: 'message_empty' };
  const activeWallets = new Set((payload.wallets ?? [])
    .filter((wallet) => wallet.status === 'active')
    .map((wallet) => wallet.id));
  const templates = [...(payload.transferTemplates ?? [])]
    .filter((template) => template.isActive && (!template.walletId || activeWallets.has(template.walletId)))
    .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));
  const senderText = String(sender).trim();
  let invalidPatternTemplateId = null;
  for (const template of templates) {
    const expectedSender = String(template.senderCode ?? '').trim();
    if (expectedSender && expectedSender.toLocaleUpperCase() !== senderText.toLocaleUpperCase()) continue;
    if (template.identifierKind === 'balanceRequestCode') {
      if (normalizeMessage(template.pattern) === input) {
        return {
          matched: true,
          templateId: template.id,
          templateName: template.name,
          specialCase: 'balanceRequestCode',
          extracted: { sender: senderText || null },
          financialSideEffect: false,
        };
      }
      continue;
    }
    try {
      const regex = buildInboundPatternRegex(template.pattern, {
        allowImplicitPosQuantity: Boolean(template.posId) || !template.requireReference,
      });
      const match = regex.exec(input);
      if (!match) continue;
      const extracted = match.groups ?? {};
      if (!extracted.amount) continue;
      const amount = Number(extracted.amount.replace(',', '.'));
      if (!Number.isFinite(amount) || amount <= 0) continue;
      if (template.requireReference && !extracted.ref) continue;
      if (extracted.qty && (Number(extracted.qty) < 1 || Number(extracted.qty) > 20)) continue;
      if (extracted.phone && !isPhone(extracted.phone)) continue;
      if (extracted.dest && !isPhone(extracted.dest)) continue;
      if (template.posId && !isPhone(senderText)) continue;
      if (!template.posId && !extracted.phone && !extracted.account && template.identifierKind !== 'senderNameOnly') continue;
      return {
        matched: true,
        templateId: template.id,
        templateName: template.name,
        extracted: {
          amount: extracted.amount,
          phone: extracted.phone ?? null,
          account: extracted.account?.trim() ?? null,
          reference: extracted.ref ?? null,
          quantity: extracted.qty ? Number(extracted.qty) : 1,
          destination: extracted.dest ?? null,
          sender: senderText || null,
        },
        financialSideEffect: false,
      };
    } catch {
      invalidPatternTemplateId ??= template.id;
    }
  }
  if (invalidPatternTemplateId) {
    return { matched: false, reason: 'template_pattern_invalid', templateId: invalidPatternTemplateId };
  }
  return { matched: false, reason: 'no_template_matched' };
}

export function previewOutboundTemplate(template, values = {}) {
  const definition = OUTBOUND_TEMPLATES[template?.key];
  if (!definition || typeof template.body !== 'string') {
    return { ok: false, reason: 'template_unknown' };
  }
  const placeholders = templatePlaceholders(template.body);
  const canonicalKeys = placeholders.map(canonicalVariable);
  if (canonicalKeys.some((key) => key == null)) return { ok: false, reason: 'variable_unknown' };
  if (canonicalKeys.some((key) => !VARIABLE_SCOPES[key]?.includes(definition.scope))) {
    return { ok: false, reason: 'variable_scope_invalid' };
  }
  const seenKeys = new Set(canonicalKeys);
  const missingRequired = definition.required.filter((key) => !seenKeys.has(key));
  if (missingRequired.length) {
    return { ok: false, reason: 'required_variable_missing', variables: missingRequired };
  }
  const rendered = template.body.replace(/\{([^{}]+)\}|%([A-Za-z][A-Za-z0-9_]*)/gu, (token, brace, percent) => {
    const key = brace ?? percent;
    const canonical = canonicalVariable(key);
    const sample = values[key] ?? values[canonical];
    return sample == null ? token : String(sample);
  });
  const unresolved = templatePlaceholders(rendered);
  if (unresolved.length) return { ok: false, reason: 'variable_value_missing', variables: unresolved };
  if (!rendered.trim()) return { ok: false, reason: 'rendered_message_empty' };
  return { ok: true, preview: rendered };
}

export function normalizeDraftInput(input) {
  if (!isRecord(input)) return { ok: false, error: 'draft_invalid' };
  const scope = normalizeScope(input.scope);
  if (!scope) return { ok: false, error: 'scope_invalid' };
  if (!isRecord(input.payload)) return { ok: false, error: 'payload_invalid' };
  const payload = {
    wallets: input.payload.wallets ?? [],
    transferTemplates: input.payload.transferTemplates ?? [],
    outboundTemplates: input.payload.outboundTemplates ?? [],
  };
  const validation = validateTemplatePayload(payload);
  if (!validation.ok) return { ok: false, error: 'payload_invalid', details: validation.errors };
  return {
    ok: true,
    value: {
      id: typeof input.id === 'string' && SAFE_ID.test(input.id) ? input.id : null,
      scope,
      payload,
      baseReleaseId: typeof input.baseReleaseId === 'string' && SAFE_ID.test(input.baseReleaseId)
        ? input.baseReleaseId
        : null,
      title: isText(input.title, 120) ? input.title.trim() : '',
    },
  };
}

export const TEMPLATE_CENTER_LIMITS = Object.freeze({
  maxCollectionItems: MAX_COLLECTION_ITEMS,
  maxPayloadBytes: MAX_PAYLOAD_BYTES,
});

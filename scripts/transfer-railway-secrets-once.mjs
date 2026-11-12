const enabled = process.env.RAILWAY_SECRET_TRANSFER_ONCE === 'true';
if (!enabled) {
  console.log('Railway secret transfer: skipped (one-shot gate is disabled).');
  process.exit(0);
}

if (process.env.VERCEL_ENV !== 'production') {
  throw new Error('Railway secret transfer is restricted to a Vercel production build.');
}

const token = process.env.RAILWAY_TRANSFER_TOKEN;
const entitlementPrivateKey = process.env.ENTITLEMENT_PRIVATE_KEY;
const networkSecretMaster = process.env.KROTAK_HMAC_SECRET;

if (!token || !entitlementPrivateKey || !networkSecretMaster) {
  throw new Error('Railway secret transfer is missing a required environment variable.');
}
if (Buffer.byteLength(networkSecretMaster, 'utf8') < 32) {
  throw new Error('Railway secret transfer refused: KROTAK_HMAC_SECRET is shorter than 32 bytes.');
}
if (!entitlementPrivateKey.includes('PRIVATE KEY')) {
  throw new Error('Railway secret transfer refused: ENTITLEMENT_PRIVATE_KEY format is invalid.');
}

const query = `
  mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) {
    variableCollectionUpsert(input: $input)
  }
`;

const response = await fetch('https://backboard.railway.com/graphql/v2', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    query,
    variables: {
      input: {
        projectId: '42aa5939-70da-48f0-b4c2-42d81deb615c',
        environmentId: 'f5ecea44-7db1-4695-9d3b-321dca07ce40',
        serviceId: 'caabfa2c-2828-4291-9206-f934c4c4402b',
        variables: {
          ENTITLEMENT_PRIVATE_KEY: entitlementPrivateKey,
          KROTAK_HMAC_SECRET: networkSecretMaster,
        },
        skipDeploys: true,
      },
    },
  }),
});

let result;
try {
  result = await response.json();
} catch {
  throw new Error('Railway secret transfer failed: Railway returned a non-JSON response.');
}

if (!response.ok || result?.errors?.length || result?.data?.variableCollectionUpsert !== true) {
  const traceId = result?.errors?.[0]?.extensions?.traceId;
  throw new Error(`Railway secret transfer failed${traceId ? ` (traceId: ${traceId})` : ''}.`);
}

console.log('Railway secret transfer succeeded for: ENTITLEMENT_PRIVATE_KEY, KROTAK_HMAC_SECRET.');

#!/usr/bin/env node
'use strict';

import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// Vercel may store environment values with literal backslash-n sequences.
// The activation handler converts those sequences back to PEM newlines.
const privateKeyEnvValue = privateKey.trimEnd().replace(/\n/g, '\\n');

console.log('Generated a new Ed25519 key pair locally.');
console.log('Keep the private key secret; do not commit or share it.');
console.log('\n--- ENTITLEMENT_PRIVATE_KEY value (copy this single line into Vercel) ---');
console.log(privateKeyEnvValue);
console.log('\n--- Public key (embed in the client for signature verification) ---');
console.log(publicKey.trimEnd());

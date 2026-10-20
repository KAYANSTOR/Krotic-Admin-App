#!/usr/bin/env node
'use strict';

import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

console.log('Ed25519 key pair generated locally. Keep the private key secret.');
console.log('\n--- PRIVATE KEY (set as Vercel ENTITLEMENT_PRIVATE_KEY) ---');
console.log(privateKey.trimEnd());
console.log('\n--- PUBLIC KEY (embed in the client for signature verification) ---');
console.log(publicKey.trimEnd());

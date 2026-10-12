import test from 'node:test';
import assert from 'node:assert/strict';
import { canPreloadRoute } from '../src/lib/routeLoaders.js';

function withConnection(connection, callback) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { connection },
  });
  try {
    return callback();
  } finally {
    if (original) {
      Object.defineProperty(globalThis, 'navigator', original);
    } else {
      delete globalThis.navigator;
    }
  }
}

test('skips optional route preload for saveData and 2g connections', () => {
  withConnection({ saveData: true, effectiveType: '4g' }, () => {
    assert.equal(canPreloadRoute(), false);
  });
  withConnection({ saveData: false, effectiveType: '2g' }, () => {
    assert.equal(canPreloadRoute(), false);
  });
  withConnection({ saveData: false, effectiveType: 'slow-2g' }, () => {
    assert.equal(canPreloadRoute(), false);
  });
});

test('allows optional route preload when the connection is suitable', () => {
  withConnection({ saveData: false, effectiveType: '4g' }, () => {
    assert.equal(canPreloadRoute(), true);
  });
});

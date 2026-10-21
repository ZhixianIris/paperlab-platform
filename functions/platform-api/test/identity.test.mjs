import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCloudBaseIdentityResolver, requireUser } = require('../src/identity.js');

const KEYS = ['TCB_UUID', 'TCB_CUSTOM_USER_ID', 'TCB_ISANONYMOUS_USER'];

function withEnv(values, fn) {
  const previous = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return fn();
  } finally {
    for (const key of KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('trusted runtime identity uses TCB_UUID, never request payload fields', () => {
  withEnv({ TCB_UUID: 'auth-user-123', TCB_CUSTOM_USER_ID: 'custom-1', TCB_ISANONYMOUS_USER: 'false' }, () => {
    const identity = createCloudBaseIdentityResolver()();
    assert.deepEqual(identity, {
      authenticated: true,
      uid: 'auth-user-123',
      customUserId: 'custom-1',
      isAnonymous: false,
    });
    assert.equal(requireUser(identity), 'auth-user-123');
  });
});

test('anonymous and missing runtime identity are rejected', () => {
  withEnv({ TCB_UUID: 'anon-123', TCB_ISANONYMOUS_USER: 'true' }, () => {
    const identity = createCloudBaseIdentityResolver()();
    assert.equal(identity.authenticated, false);
    assert.throws(() => requireUser(identity), /请先登录/);
  });
  withEnv({}, () => {
    const identity = createCloudBaseIdentityResolver()();
    assert.equal(identity.authenticated, false);
    assert.throws(() => requireUser(identity), /请先登录/);
  });
});

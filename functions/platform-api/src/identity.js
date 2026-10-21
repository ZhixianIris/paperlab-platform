'use strict';

const { AppError } = require('./errors');

/**
 * Trusted caller identity.
 *
 * The CloudBase Event runtime injects the authenticated caller into the
 * function environment. This is the exact context that the official
 * `@cloudbase/node-sdk` `auth().getUserInfo()` reads in its `TCB_UUID`
 * implementation:
 *
 *   getUserInfo() -> { uid: TCB_UUID, customUserId: TCB_CUSTOM_USER_ID,
 *                      isAnonymous: TCB_ISANONYMOUS_USER === 'true' }
 *
 * We read that runtime-injected value directly instead of shipping the whole
 * Node SDK (and its unrelated NoSQL/axios/lodash dependency tree) inside this
 * single-purpose function. The request body is never consulted.
 */
function createCloudBaseIdentityResolver() {
  return function resolveCloudBaseIdentity() {
    const uid = process.env.TCB_UUID || '';
    const customUserId = process.env.TCB_CUSTOM_USER_ID || '';
    const isAnonymous = process.env.TCB_ISANONYMOUS_USER === 'true';
    return {
      authenticated: Boolean(uid) && !isAnonymous,
      uid,
      customUserId,
      isAnonymous,
    };
  };
}

function requireUser(identity) {
  if (!identity || !identity.authenticated || !identity.uid || identity.isAnonymous) {
    throw new AppError('unauthenticated', '请先登录', { status: 401 });
  }
  return identity.uid;
}

module.exports = { createCloudBaseIdentityResolver, requireUser };

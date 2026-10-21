'use strict';

const { loadConfig } = require('./src/config');
const { createPool } = require('./src/db');
const { createApp } = require('./src/app');
const { createCloudBaseIdentityResolver } = require('./src/identity');

const config = loadConfig(process.env);
const pool = createPool(config.pg);
const resolveCloudBaseIdentity = createCloudBaseIdentityResolver();
const app = createApp({ pool, config });

exports.main = async (event, context = {}) => {
  // Identity comes exclusively from the CloudBase invocation context. Any
  // userId/role/price/tenant id supplied in event.payload is ignored.
  let identity = { authenticated: false, uid: '', isAnonymous: true };
  try {
    identity = resolveCloudBaseIdentity();
  } catch (error) {
    console.error('[paperlab] identity resolution failed', { name: error?.name });
  }
  return app.handle(event, {
    identity,
    requestId: context.request_id || context.requestId,
  });
};

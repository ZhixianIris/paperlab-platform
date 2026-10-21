'use strict';

/**
 * Payment boundary. Providers implement this interface only after merchant
 * credentials, signed notification verification, amount/order matching and
 * idempotent event persistence exist. The platform deliberately ships with no
 * simulated provider: with no merchant credentials every top-up is disabled.
 */
class PaymentProvider {
  get configured() {
    return false;
  }

  async createPayment() {
    throw new Error('Payment provider is not implemented');
  }

  async verifyNotification() {
    throw new Error('Payment notifications are disabled');
  }
}

class UnconfiguredPaymentProvider extends PaymentProvider {
  constructor(name) {
    super();
    this.name = name || 'unconfigured';
  }
}

function createPaymentService(config) {
  const provider = new UnconfiguredPaymentProvider(config.payments.provider);
  const enabled =
    Boolean(config.payments.enabled) &&
    Boolean(config.payments.provider) &&
    Boolean(config.payments.merchantId) &&
    Boolean(config.payments.apiV3Key);

  return {
    enabled,
    status() {
      return {
        enabled,
        provider: config.payments.provider || null,
        reason: enabled ? null : 'payments_not_configured',
        message: enabled
          ? null
          : '充值暂未开放。支付商户资质与签名回调尚未配置。',
      };
    },
    async createPayment() {
      if (!config.payments.enabled) {
        return { disabled: true };
      }
      // Even when the switch is on, an unimplemented/unsigned provider must
      // never be allowed to create a fake successful payment.
      if (!provider.configured) {
        return { disabled: true };
      }
      return provider.createPayment();
    },
  };
}

module.exports = { PaymentProvider, UnconfiguredPaymentProvider, createPaymentService };

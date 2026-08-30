'use strict';

/**
 * A stored Cashfree secret that cannot be decrypted must not reach a customer.
 *
 * AES-GCM fails loudly rather than returning garbage, so a
 * CREDENTIALS_ENCRYPTION_KEY that has changed since a cinema's credentials
 * were saved makes `credentials.decrypt` throw. That throw used to escape
 * every handler in consumer.service.paymentInit - which folds only transient,
 * auth and not-configured errors into a 503 - and reached the customer as a
 * 500 carrying a full stack trace.
 *
 * `.claude/rules/payments.md` is explicit that a bad `payment_gateway_config`
 * row surfaces as the same clean 503 a cinema with no credentials gets, so
 * this pins that: the raw crypto error is converted at the provider boundary,
 * and the operator detail goes to the log instead of the response.
 */

jest.mock('../src/config/database', () => {
  const models = {
    PaymentGatewayConfig: { findOne: jest.fn() },
  };

  return {
    models,
    sequelize: { transaction: jest.fn(), query: jest.fn(), authenticate: jest.fn() },
    Sequelize: {},
  };
});

jest.mock('../src/utils/credentials', () => ({
  encrypt: jest.fn(),
  decrypt: jest.fn(),
}));

const { models } = require('../src/config/database');
const credentials = require('../src/utils/credentials');
const cashfree = require('../src/services/cashfree.client');

const NOT_CONFIGURED = 'Cashfree is not configured for this cinema';

const CONFIG_ROW = {
  gatewayId: 'TEST_APP_ID',
  gatewaySecretEncrypted: 'not-decryptable-with-the-current-key',
  environment: 'test',
};

describe('resolveCredentials with an undecryptable stored secret', () => {
  it('reports it as "not configured" rather than leaking the crypto error', async () => {
    models.PaymentGatewayConfig.findOne.mockResolvedValue(CONFIG_ROW);
    credentials.decrypt.mockImplementation(() => {
      // Exactly what Node throws when the GCM auth tag does not verify.
      throw new Error('Unsupported state or unable to authenticate data');
    });

    await expect(cashfree.resolveCredentials(8)).rejects.toThrow(NOT_CONFIGURED);
  });

  it('does not fall through to the global env credentials', async () => {
    // Silently using the deployment-wide account for a cinema whose own
    // credentials are unreadable would bill the wrong merchant.
    models.PaymentGatewayConfig.findOne.mockResolvedValue(CONFIG_ROW);
    credentials.decrypt.mockImplementation(() => {
      throw new Error('Unsupported state or unable to authenticate data');
    });

    await expect(cashfree.resolveCredentials(8)).rejects.toThrow(NOT_CONFIGURED);
    expect(credentials.decrypt).toHaveBeenCalledWith(CONFIG_ROW.gatewaySecretEncrypted);
  });

  it('still resolves a row whose secret decrypts', async () => {
    models.PaymentGatewayConfig.findOne.mockResolvedValue(CONFIG_ROW);
    credentials.decrypt.mockReturnValue('the-real-secret');

    await expect(cashfree.resolveCredentials(8)).resolves.toEqual({
      appId: 'TEST_APP_ID',
      secretKey: 'the-real-secret',
      isProduction: false,
    });
  });
});

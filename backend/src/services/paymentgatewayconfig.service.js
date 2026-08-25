'use strict';

/**
 * Per-cinema Cashfree credentials.
 *
 * One active row per cinema (enforced by the filtered unique index
 * `UQ_payment_gateway_config_active_cinema`, from the table's original
 * migration). `gatewayId` carries Cashfree's APP_ID, `gatewaySecretEncrypted`
 * carries the SECRET_KEY encrypted with AES-256-GCM (src/utils/credentials.js)
 * - the plaintext secret exists in memory only for as long as one request
 * needs it, and is never logged, never returned in an API response, and
 * never stored anywhere but this one encrypted column.
 *
 * REPLACING A CINEMA'S CREDENTIALS
 *
 * There is no "update the secret in place" - a new active row is created and
 * the previous one is deactivated instead, in the same spirit as a banner's
 * soft delete: the old row stays as a historical record (when was this
 * cinema on which credential?) rather than being overwritten and lost.
 */

const { models, sequelize } = require('../config/database');
const { NotFoundError, ConflictError } = require('../utils/errors');
const { ROLES } = require('../constants');
const credentials = require('../utils/credentials');

/** Never `gatewaySecretEncrypted` - see the header note. */
const PUBLIC_ATTRIBUTES = [
  'id',
  'cinemaId',
  'gatewayId',
  'environment',
  'isActive',
  'createdAt',
  'updatedAt',
];

function serializeConfig(config) {
  if (!config) return null;

  const result = {};
  for (const attribute of PUBLIC_ATTRIBUTES) {
    result[attribute] = config[attribute];
  }
  // Tells the Dashboard whether a secret is on file at all, without ever
  // exposing it - the one piece of the secret's existence that is safe to
  // confirm.
  result.hasSecret = Boolean(config.gatewaySecretEncrypted);

  return result;
}

function cinemaScope(actor) {
  return {
    association: 'cinema',
    attributes: ['id', 'chainId'],
    required: true,
    where: actor.role === ROLES.OWNER ? undefined : { chainId: actor.chainId },
  };
}

async function findCinemaInScope(actor, cinemaId) {
  const where = { id: cinemaId };
  if (actor.role !== ROLES.OWNER) where.chainId = actor.chainId;

  const cinema = await models.Cinema.findOne({ where, attributes: ['id', 'chainId'] });
  if (!cinema) throw new NotFoundError('Cinema');

  return cinema;
}

/** The active config for a cinema, or null. Never exposes the secret. */
async function getActiveConfig(actor, cinemaId) {
  await findCinemaInScope(actor, cinemaId);

  const config = await models.PaymentGatewayConfig.findOne({
    where: { cinemaId, isActive: true },
    attributes: [...PUBLIC_ATTRIBUTES, 'gatewaySecretEncrypted'],
  });

  return serializeConfig(config);
}

/**
 * Replace a cinema's active Cashfree credentials.
 *
 * `gatewaySecretEncrypted` is a genuinely required input here - not
 * optional, not merge-with-existing - so there is never a moment where a
 * caller can update `environment`/`gatewayId` alone and leave the secret
 * pointing at a value nobody can currently see or confirm. Deactivating the
 * previous row and inserting the new one happens in one transaction so a
 * request that fails partway never leaves a cinema with either zero active
 * configs or two.
 */
async function setCredentials(actor, cinemaId, { gatewayId, secretKey, environment }) {
  await findCinemaInScope(actor, cinemaId);

  if (!secretKey || typeof secretKey !== 'string') {
    throw new ConflictError('secretKey is required to configure Cashfree credentials', {
      cinemaId,
    });
  }

  const gatewaySecretEncrypted = credentials.encrypt(secretKey);

  const config = await sequelize.transaction(async (transaction) => {
    await models.PaymentGatewayConfig.update(
      { isActive: false, updatedBy: actor.id },
      { where: { cinemaId, isActive: true }, transaction }
    );

    return models.PaymentGatewayConfig.create(
      {
        cinemaId,
        // gatewayUrl remains unused - see the environment-column migration's
        // note on why it was not repurposed for this.
        gatewayUrl: '',
        gatewayId,
        gatewaySecretEncrypted,
        environment,
        isActive: true,
        createdBy: actor.id,
        updatedBy: actor.id,
      },
      { transaction }
    );
  });

  return serializeConfig(config);
}

/** Deactivates the cinema's active config without replacing it. */
async function deactivateConfig(actor, cinemaId) {
  await findCinemaInScope(actor, cinemaId);

  const config = await models.PaymentGatewayConfig.findOne({
    where: { cinemaId, isActive: true },
  });

  if (!config) throw new NotFoundError('Active payment gateway config');

  await config.update({ isActive: false, updatedBy: actor.id });

  return serializeConfig(config);
}

module.exports = { getActiveConfig, setCredentials, deactivateConfig, serializeConfig };

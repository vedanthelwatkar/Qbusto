'use strict';

/**
 * Database access point for application code.
 *
 * The model layer (backend/models) is frozen and owns the Sequelize instance -
 * it is loaded by the Sequelize CLI as well as by the app, and reads
 * backend/config/config.js for connection settings. This module is the single
 * place application code reaches for it, so nothing under src/ needs to know
 * the relative path out of src/.
 *
 *   const { models, sequelize } = require('../config/database');
 *   const user = await models.User.findByPk(id);
 */

const db = require('../../models');

const logger = require('./logger');

const { sequelize, Sequelize } = db;

// config/config.js (frozen, and shared with the Sequelize CLI) leaves query
// logging at its default, which writes raw SQL to stdout. Route it through
// winston instead so it obeys LOG_LEVEL and matches the rest of the output.
sequelize.options.logging = (sql, timingMs) =>
  logger.debug(sql, typeof timingMs === 'number' ? { timingMs } : undefined);

/** Every loaded model, keyed by model name (User, Order, ...). */
const models = Object.fromEntries(
  Object.entries(db).filter(([key]) => key !== 'sequelize' && key !== 'Sequelize')
);

async function connect() {
  await sequelize.authenticate();
  logger.info('Database connection established', {
    host: sequelize.config.host,
    database: sequelize.config.database,
  });
}

async function disconnect() {
  await sequelize.close();
  logger.info('Database connection closed');
}

module.exports = { sequelize, Sequelize, models, connect, disconnect };

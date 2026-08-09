'use strict';

/**
 * Winston logger.
 *
 * - Console transport is always attached (stdout is the standard place for a
 *   containerised process to log). It is human-readable in development and
 *   structured JSON in production.
 * - File transports are attached in production only: an error-only log and a
 *   combined log, both rotated by size.
 * - Silent under NODE_ENV=test so the test output stays readable.
 */

const fs = require('fs');
const path = require('path');
const winston = require('winston');

const env = require('./env');

const logDir = path.isAbsolute(env.log.dir)
  ? env.log.dir
  : path.join(__dirname, '..', '..', env.log.dir);

const transports = [];

const consoleFormat = env.isProduction
  ? winston.format.combine(winston.format.timestamp(), winston.format.json())
  : winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const extra = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} ${level} ${message}${extra}`;
      })
    );

transports.push(new winston.transports.Console({ format: consoleFormat }));

if (env.isProduction) {
  fs.mkdirSync(logDir, { recursive: true });

  const fileFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  );

  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    })
  );
}

const logger = winston.createLogger({
  level: env.log.level,
  levels: winston.config.npm.levels,
  defaultMeta: { service: 'qbusto-backend' },
  format: winston.format.errors({ stack: true }),
  transports,
  silent: env.isTest,
  exitOnError: false,
});

module.exports = logger;

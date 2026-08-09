'use strict';

/**
 * Jest global setup.
 *
 * Forces NODE_ENV=test (silences the logger and disables rate limiting) and
 * supplies a deterministic JWT secret so token tests do not depend on whatever
 * is in the developer's .env.
 *
 * No database connection is opened: every test that would touch the database
 * mocks the repository layer instead.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-value-at-least-16-chars';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_ISSUER = 'qbusto-test';

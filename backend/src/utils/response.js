'use strict';

/**
 * Response helpers.
 *
 * Every response the API sends goes through one of these, so clients can rely
 * on a single envelope shape:
 *
 *   success  { success: true,  message, data, meta }
 *   paginated{ success: true,  message, data, meta: { ..., pagination } }
 *   error    { success: false, error: { code, message, details }, meta }
 *
 * `meta` always carries a timestamp and the request id, which makes a report
 * from the field traceable to a log line.
 */

const { ERROR_CODES, PAGINATION } = require('../constants');

function buildMeta(res, extra) {
  return {
    timestamp: new Date().toISOString(),
    requestId: res.req && res.req.id ? res.req.id : undefined,
    ...extra,
  };
}

/**
 * @param {import('express').Response} res
 * @param {object}  [options]
 * @param {*}       [options.data]        Payload. Omitted from the body if undefined.
 * @param {string}  [options.message]
 * @param {number}  [options.statusCode]  Defaults to 200.
 * @param {object}  [options.meta]        Merged into the meta block.
 */
function success(res, { data, message = 'OK', statusCode = 200, meta } = {}) {
  const body = { success: true, message, meta: buildMeta(res, meta) };
  if (data !== undefined) body.data = data;
  return res.status(statusCode).json(body);
}

/**
 * Paginated list response. `page` and `limit` should be the values actually
 * used for the query, not the raw request values.
 *
 * @param {import('express').Response} res
 * @param {object}   options
 * @param {Array}    options.data
 * @param {number}   options.total   Total matching rows, ignoring pagination.
 * @param {number}   [options.page]
 * @param {number}   [options.limit]
 */
function paginated(
  res,
  {
    data,
    total,
    page = PAGINATION.DEFAULT_PAGE,
    limit = PAGINATION.DEFAULT_LIMIT,
    message = 'OK',
    statusCode = 200,
    meta,
  }
) {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

  return res.status(statusCode).json({
    success: true,
    message,
    data,
    meta: buildMeta(res, {
      ...meta,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    }),
  });
}

/**
 * Error response. Normally reached through the global error handler rather than
 * called directly.
 *
 * @param {import('express').Response} res
 * @param {object}  options
 * @param {string}  options.message
 * @param {number}  [options.statusCode]
 * @param {string}  [options.code]     Machine-readable code from ERROR_CODES.
 * @param {*}       [options.details]  Field-level detail, omitted when null.
 */
function error(
  res,
  { message, statusCode = 500, code = ERROR_CODES.INTERNAL_ERROR, details = null, meta } = {}
) {
  const body = {
    success: false,
    error: { code, message },
    meta: buildMeta(res, meta),
  };
  if (details !== null && details !== undefined) body.error.details = details;

  return res.status(statusCode).json(body);
}

module.exports = { success, paginated, error };

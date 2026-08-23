'use strict';

/**
 * Formatting a JavaScript date for comparison against a SQL Server `datetime`
 * column.
 *
 * The client's `session` table stores show times as `datetime`, which carries
 * no time-zone offset. Sequelize's mssql dialect binds a JS Date as an
 * offset-bearing literal, and SQL Server refuses to convert that to `datetime`
 * - the query fails with "Conversion failed when converting date and/or time
 * from character string" rather than returning the wrong rows, which at least
 * makes the mismatch obvious.
 *
 * Formatting the bound value ourselves sidesteps it. Local time is used
 * deliberately: the stored values are cinema-local wall clock with no offset,
 * so comparing them against a UTC instant would shift every boundary by the
 * server's offset.
 *
 * Only needed for the source system's `datetime` columns. QBusto's own tables
 * use `datetime2` and need none of this.
 */

const { literal } = require('sequelize');

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

/**
 * @param {Date} date
 * @returns {string} e.g. "2026-08-23 18:45:00.000"
 */
function toSqlDateTime(date) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.` +
    `${pad(date.getMilliseconds(), 3)}`
  );
}

/**
 * The same value as a literal, for use in a `where` clause.
 *
 * A plain string is not enough: Sequelize re-parses whatever it is given for a
 * DATE attribute and re-emits it in its own offset-bearing form, which is the
 * format `datetime` rejects. A literal is passed through untouched.
 *
 * Safe to interpolate: the text is produced from a Date by toSqlDateTime, so
 * it is digits and separators and never carries caller input.
 *
 * @param {Date} date
 * @returns {import('sequelize').Utils.Literal}
 */
function sqlDateTimeLiteral(date) {
  return literal(`'${toSqlDateTime(date)}'`);
}

module.exports = { toSqlDateTime, sqlDateTimeLiteral };

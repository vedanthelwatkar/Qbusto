'use strict';

/**
 * Creates `cinema_content`: one row per cinema, holding the "About Cinema" /
 * "Terms & Conditions" footer content shown on the Consumer app.
 *
 * ONE TABLE FOR BOTH, PER THE SPEC
 *
 * `cinema_name`, `gst_number` and `fssai_number` already exist on `cinemas`
 * and are read from there - this table only adds what does not already exist
 * (`contact_no`, `mail_id`) plus the Terms & Conditions content.
 *
 * `tnc_points` IS A JSON ARRAY IN ONE COLUMN, NOT A CHILD TABLE
 *
 * A day's price/discount got seven fixed, named columns because there are
 * exactly seven days, always. A cinema's T&C is a free-form, staff-authored
 * list of arbitrary length (the reference design shows eight) with no
 * per-point field other than its text and its position - a child table would
 * add a `sequence` column and a join for no query this app ever runs beyond
 * "give me this cinema's points, in order". Stored as `NVARCHAR(MAX)` holding
 * `JSON.stringify(string[])`, parsed/serialized in `cinemaContent.service.js`
 * only - the model and the column stay a plain string.
 *
 * NULLABLE, ONE-TO-ONE, NO ROW REQUIRED
 *
 * A cinema with nothing configured here simply has no row - the service
 * returns an empty shape rather than the Dashboard being forced to create one
 * before it can be edited. `UQ_cinema_content_cinema_id` enforces at most one
 * row per cinema.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const [tables] = await queryInterface.sequelize.query(
      `SELECT COUNT(*) AS n FROM sys.tables WHERE name = 'cinema_content'`
    );
    if (Number(tables[0].n) > 0) return;

    await queryInterface.createTable('cinema_content', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      cinema_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: 'UQ_cinema_content_cinema_id',
        references: { model: 'cinemas', key: 'id' },
        // Matches banners/product_pricing: NO ACTION avoids the multiple-
        // cascade-path error SQL Server raises once a table sits under two or
        // more cascading FKs to the same root.
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      contact_no: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      mail_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      // JSON-encoded string[], see header note. NULL/'[]' both mean "no points".
      tnc_points: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      updated_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      // Raw 'DATETIME2', not Sequelize.DATE - see timezone.storage note in
      // CLAUDE.md: Sequelize's own DATE type renders DATETIMEOFFSET here,
      // which is not what every other table's created_at/updated_at uses.
      created_at: { type: 'DATETIME2', allowNull: false },
      updated_at: { type: 'DATETIME2', allowNull: false },
    });
  },

  async down(queryInterface) {
    const [tables] = await queryInterface.sequelize.query(
      `SELECT COUNT(*) AS n FROM sys.tables WHERE name = 'cinema_content'`
    );
    if (Number(tables[0].n) === 0) return;

    const [rows] = await queryInterface.sequelize.query(
      `SELECT COUNT(*) AS n FROM [dbo].[cinema_content]`
    );
    if (Number(rows[0].n) > 0) {
      throw new Error(
        'Refusing to drop cinema_content: it holds data. Remove the rows first if this is truly intended.'
      );
    }

    await queryInterface.dropTable('cinema_content');
  },
};

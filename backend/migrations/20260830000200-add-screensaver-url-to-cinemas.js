'use strict';

/**
 * Adds `screensaver_url` to `cinemas`.
 *
 * The Consumer's screensaver is the first thing a customer sees at a seat or
 * kiosk, and it is per-cinema artwork rather than one shared asset - each
 * cinema runs its own promotional board. Until now the screensaver was a fixed
 * text hero in the Consumer app with nothing to configure.
 *
 * Same shape and convention as `chains.logo_image_url` and `banners.image_url`:
 * VARCHAR(500) holding EITHER an application upload path
 * (`/uploads/cinemas/<file>`) or an external URL. One column, no discriminator
 * - see .claude/rules/uploads.md. The image itself is never stored in SQL
 * Server; the bytes live under FILE_STORAGE_PATH like every other upload.
 *
 * NULLABLE deliberately, even though the API requires it when CREATING a
 * cinema. The cinemas that already exist have no screensaver and must stay
 * valid rows, and the Consumer falls back to its original text hero when a
 * cinema has none. Enforcing it at the column would mean inventing artwork for
 * existing records; enforcing it in the create validator gets the requirement
 * without rewriting history.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('cinemas', 'screensaver_url', {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('cinemas', 'screensaver_url');
  },
};

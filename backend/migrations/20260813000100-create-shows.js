'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('shows', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      // Denormalized from pos_integrations so the three-hour window query and
      // tenant scoping do not need a join.
      cinema_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'cinemas', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      // Nullable on purpose: a show can arrive from the POS before its external
      // screen has been mapped in screen_pos_mappings. Hiding such a show would
      // silently lose it, so it is kept with an unresolved screen instead.
      screen_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'screens', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      pos_integration_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'pos_integrations', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      // Provider session/show identifier. Half of the natural key.
      external_session_id: { type: 'VARCHAR(100)', allowNull: false },
      // As returned by the POS, before mapping to screen_id.
      external_screen_id: { type: 'VARCHAR(50)', allowNull: true },
      external_film_id: { type: 'VARCHAR(50)', allowNull: true },
      // Display snapshot. Width matches orders.film_title.
      film_title: { type: 'VARCHAR(200)', allowNull: false },
      // UTC instant. The POS supplies cinema-local wall clock; conversion happens
      // centrally in the sync service (Phase B5), never in a provider adapter.
      show_time: { type: 'DATETIME2', allowNull: false },
      // Provider-neutral lifecycle. Deliberately not is_active: these rows mirror
      // external state rather than being staff-managed master data.
      status: { type: 'VARCHAR(20)', allowNull: false, defaultValue: 'scheduled' },
      // Last time the POS confirmed this show exists. Drives staleness reporting.
      last_synced_at: { type: 'DATETIME2', allowNull: false },
      // No created_by/updated_by: these rows are machine-written by the POS sync,
      // not authored by a user. Matches order_pos_context and pos_transactions.
      created_at: { type: 'DATETIME2', allowNull: false },
      updated_at: { type: 'DATETIME2', allowNull: false },
    });

    // The natural key. Sync is an upsert on this pair, so the unique index is the
    // entire duplicate-prevention mechanism.
    await queryInterface.addIndex('shows', ['pos_integration_id', 'external_session_id'], {
      name: 'UQ_shows_external_session',
      unique: true,
    });

    // Exactly the shape of the three-hour window query in Phase B6.
    await queryInterface.addIndex('shows', ['cinema_id', 'show_time'], {
      name: 'IX_shows_cinema_show_time',
    });

    await queryInterface.sequelize.query(
      "ALTER TABLE [shows] ADD CONSTRAINT [CK_shows_status] CHECK ([status] IN ('scheduled','cancelled'))"
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('shows');
  },
};

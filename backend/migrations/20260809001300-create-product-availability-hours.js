'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('product_availability_hours', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      cinema_product_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'cinema_products', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      // 0 = all days, 1 = Monday ... 7 = Sunday
      day_of_week: { type: 'TINYINT', allowNull: false },
      start_time: { type: 'TIME', allowNull: false },
      end_time: { type: 'TIME', allowNull: false },
      // Audit FKs: NO ACTION, not SET NULL - see 20260809000600 for why.
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
      created_at: { type: 'DATETIME2', allowNull: false },
      updated_at: { type: 'DATETIME2', allowNull: false },
    });

    await queryInterface.addIndex(
      'product_availability_hours',
      ['cinema_product_id', 'day_of_week', 'start_time', 'end_time'],
      { name: 'UQ_product_availability_hours', unique: true }
    );

    // Lookup index from schema.dbml (not listed in schema.md's index summary).
    await queryInterface.addIndex('product_availability_hours', ['cinema_product_id', 'day_of_week'], {
      name: 'IX_product_availability_hours_lookup',
    });

    // start_time < end_time is deliberately NOT enforced so overnight windows
    // can be represented; the application interprets them.
    await queryInterface.sequelize.query(
      'ALTER TABLE [product_availability_hours] ADD CONSTRAINT [CK_product_availability_hours_day_of_week] ' +
        'CHECK ([day_of_week] BETWEEN 0 AND 7)'
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('product_availability_hours');
  },
};

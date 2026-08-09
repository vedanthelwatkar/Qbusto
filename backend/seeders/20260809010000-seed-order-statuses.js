'use strict';

const STATUSES = [
  { code: 'initiated', name: 'Initiated', description: 'Order created, not yet confirmed.' },
  { code: 'confirmed', name: 'Confirmed', description: 'Order confirmed and accepted.' },
  { code: 'preparing', name: 'Preparing', description: 'Kitchen is preparing the order.' },
  { code: 'ready', name: 'Ready', description: 'Order is ready for delivery or pickup.' },
  { code: 'delivered', name: 'Delivered', description: 'Order handed over to the customer.' },
  { code: 'rejected', name: 'Rejected', description: 'Order rejected and not fulfilled.' },
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();

    await queryInterface.bulkInsert(
      'order_statuses',
      STATUSES.map((status) => ({
        ...status,
        is_active: 1,
        created_at: now,
        updated_at: now,
      }))
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('order_statuses', {
      code: { [Sequelize.Op.in]: STATUSES.map((status) => status.code) },
    });
  },
};

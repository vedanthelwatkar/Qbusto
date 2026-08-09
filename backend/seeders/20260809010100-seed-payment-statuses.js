'use strict';

const STATUSES = [
  { code: 'pending', name: 'Pending', description: 'Payment initiated, awaiting confirmation.' },
  { code: 'paid', name: 'Paid', description: 'Payment received and confirmed.' },
  { code: 'failed', name: 'Failed', description: 'Payment attempt failed.' },
  { code: 'refunded', name: 'Refunded', description: 'Payment refunded to the customer.' },
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();

    await queryInterface.bulkInsert(
      'payment_statuses',
      STATUSES.map((status) => ({
        ...status,
        is_active: 1,
        created_at: now,
        updated_at: now,
      }))
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('payment_statuses', {
      code: { [Sequelize.Op.in]: STATUSES.map((status) => status.code) },
    });
  },
};

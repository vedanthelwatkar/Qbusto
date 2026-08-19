'use strict';

/**
 * Durable idempotency for Razorpay webhook deliveries.
 *
 * Razorpay retries a webhook until it gets a 2xx, and may deliver the same
 * event more than once or out of order. `x-razorpay-event-id` is unique per
 * event, so a UNIQUE constraint on it is what makes "process this event once"
 * survive process restarts and hold across multiple instances — the database
 * is the arbiter, not application memory.
 *
 * The existing `idempotency_keys` table could not be reused: its `order_id` is
 * NOT NULL with a foreign key, so an event for a Razorpay order we do not
 * recognise — exactly the case that most needs recording — could not be
 * stored at all. Its `key` column is also sized for a UUID v4 from the
 * Idempotency-Key header, and mixing two different families of key in one
 * unique namespace invites collisions between unrelated concerns.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('razorpay_webhook_events', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      event_id: {
        type: 'VARCHAR(64)',
        allowNull: false,
        unique: true,
        comment: 'x-razorpay-event-id header; unique per Razorpay event',
      },
      event: {
        type: 'VARCHAR(50)',
        allowNull: false,
        comment: 'e.g. payment.captured, payment.failed, order.paid',
      },
      razorpay_order_id: {
        type: 'VARCHAR(50)',
        allowNull: true,
        comment: 'From the event payload; null if the event carried none',
      },
      razorpay_payment_id: {
        type: 'VARCHAR(50)',
        allowNull: true,
      },
      // Nullable on purpose: an event for an unknown Razorpay order is still
      // recorded so a retry of it is recognised as a duplicate rather than
      // being reprocessed forever.
      order_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'orders', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      outcome: {
        type: 'VARCHAR(30)',
        allowNull: false,
        comment: 'received | applied | ignored',
      },
      reason: {
        type: 'VARCHAR(60)',
        allowNull: true,
        comment: 'Why an event was ignored, for investigation',
      },
      created_at: { type: 'DATETIME2', allowNull: false },
      updated_at: { type: 'DATETIME2', allowNull: false },
    });

    // The unique constraint above is the correctness guarantee; this index
    // serves the read that short-circuits an already-processed delivery.
    await queryInterface.addIndex('razorpay_webhook_events', ['razorpay_order_id'], {
      name: 'IX_razorpay_webhook_events_razorpay_order_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('razorpay_webhook_events');
  },
};

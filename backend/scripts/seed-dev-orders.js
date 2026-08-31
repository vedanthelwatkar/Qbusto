#!/usr/bin/env node
'use strict';

/**
 * Seed development orders - creates realistic sample orders for testing.
 *
 * This module is imported by seed-dev-data.js after building the reference data.
 * Orders are created with:
 * - Various status states (initiated, confirmed, preparing, ready, delivered, rejected)
 * - Various payment statuses (pending, paid, failed, refunded)
 * - screenId and filmTitle populated for UI testing
 * - Status logs for workflow transitions
 * - Multiple orders at different cinemas
 *
 * Uses direct database access for efficiency during seeding (bypasses validation).
 */

const { models } = require('../src/config/database');
const { ORDER_STATUSES, PAYMENT_STATUSES } = require('../src/constants');

/**
 * Sample order specifications.
 *
 * Each order includes enough information to:
 * 1. Be created in the database
 * 2. Have a realistic workflow (status transitions)
 * 3. Display screenId and filmTitle in the UI
 */
const SAMPLE_ORDERS = [
  // --- PVR Phoenix: Active orders (testing Kitchen display)
  {
    cinema: 'pvr-phoenix',
    screen: 1,
    seatNumber: 'A5',
    filmTitle: 'Inception',
    showTime: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours from now
    customerMobile: '9876543210',
    customerEmail: 'customer1@example.com',
    source: 'seat_qr',
    items: [
      { productId: null, productName: 'Regular Salted Popcorn', quantity: 1, unitPrice: '150.00' },
      { productId: null, productName: 'Coca-Cola (Large)', quantity: 2, unitPrice: '120.00' },
    ],
    orderStatus: ORDER_STATUSES.CONFIRMED,
    paymentStatus: PAYMENT_STATUSES.PAID,
    statusLogs: [
      { previousStatus: null, newStatus: ORDER_STATUSES.INITIATED, reason: 'Order created' },
      { previousStatus: ORDER_STATUSES.INITIATED, newStatus: ORDER_STATUSES.CONFIRMED, reason: 'Confirmed by staff' },
    ],
  },

  {
    cinema: 'pvr-phoenix',
    screen: 2,
    seatNumber: 'B12',
    filmTitle: 'The Dark Knight',
    showTime: new Date(Date.now() + 1.5 * 60 * 60 * 1000),
    customerMobile: '9876543211',
    source: 'seat_qr',
    items: [
      { productId: null, productName: 'Large Salted Popcorn', quantity: 1, unitPrice: '250.00' },
      { productId: null, productName: 'Coca-Cola (Regular)', quantity: 1, unitPrice: '100.00' },
      { productId: null, productName: 'Nachos with Salsa', quantity: 1, unitPrice: '180.00' },
    ],
    orderStatus: ORDER_STATUSES.PREPARING,
    paymentStatus: PAYMENT_STATUSES.PAID,
    statusLogs: [
      { previousStatus: null, newStatus: ORDER_STATUSES.INITIATED, reason: 'Order created' },
      { previousStatus: ORDER_STATUSES.INITIATED, newStatus: ORDER_STATUSES.CONFIRMED, reason: 'Confirmed by staff' },
      { previousStatus: ORDER_STATUSES.CONFIRMED, newStatus: ORDER_STATUSES.PREPARING, reason: 'Started preparing' },
    ],
  },

  {
    cinema: 'pvr-phoenix',
    screen: 1,
    seatNumber: 'C3',
    filmTitle: 'Interstellar',
    showTime: new Date(Date.now() + 3 * 60 * 60 * 1000),
    customerMobile: '9876543212',
    customerEmail: 'customer3@example.com',
    source: 'seat_qr',
    items: [
      { productId: null, productName: 'Movie Combo for One', quantity: 1, unitPrice: '280.00' },
    ],
    orderStatus: ORDER_STATUSES.READY,
    paymentStatus: PAYMENT_STATUSES.PAID,
    statusLogs: [
      { previousStatus: null, newStatus: ORDER_STATUSES.INITIATED, reason: 'Order created' },
      { previousStatus: ORDER_STATUSES.INITIATED, newStatus: ORDER_STATUSES.CONFIRMED, reason: 'Confirmed by staff' },
      { previousStatus: ORDER_STATUSES.CONFIRMED, newStatus: ORDER_STATUSES.PREPARING, reason: 'Started preparing' },
      { previousStatus: ORDER_STATUSES.PREPARING, newStatus: ORDER_STATUSES.READY, reason: 'Ready for pickup' },
    ],
  },

  {
    cinema: 'pvr-phoenix',
    screen: 3,
    seatNumber: 'D8',
    filmTitle: 'Oppenheimer',
    showTime: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago (in progress)
    customerMobile: '9876543213',
    source: 'seat_qr',
    items: [
      { productId: null, productName: 'Caramel Popcorn', quantity: 1, unitPrice: '200.00' },
      { productId: null, productName: 'Packaged Drinking Water', quantity: 1, unitPrice: '50.00' },
    ],
    orderStatus: ORDER_STATUSES.DELIVERED,
    paymentStatus: PAYMENT_STATUSES.PAID,
    deliveredAt: new Date(Date.now() - 10 * 60 * 1000),
    statusLogs: [
      { previousStatus: null, newStatus: ORDER_STATUSES.INITIATED, reason: 'Order created' },
      { previousStatus: ORDER_STATUSES.INITIATED, newStatus: ORDER_STATUSES.CONFIRMED, reason: 'Confirmed by staff' },
      { previousStatus: ORDER_STATUSES.CONFIRMED, newStatus: ORDER_STATUSES.PREPARING, reason: 'Started preparing' },
      { previousStatus: ORDER_STATUSES.PREPARING, newStatus: ORDER_STATUSES.READY, reason: 'Ready for pickup' },
      { previousStatus: ORDER_STATUSES.READY, newStatus: ORDER_STATUSES.DELIVERED, reason: 'Delivered to customer' },
    ],
  },

  // --- INOX Malad: Orders in various states
  {
    cinema: 'inox-malad',
    screen: 1,
    seatNumber: 'E5',
    filmTitle: 'Avatar: The Way of Water',
    showTime: new Date(Date.now() + 4 * 60 * 60 * 1000),
    customerMobile: '9123456789',
    customerEmail: 'customer4@example.com',
    source: 'qr',
    items: [
      { productId: null, productName: 'Regular Popcorn', quantity: 1, unitPrice: '140.00' },
      { productId: null, productName: 'Coca-Cola', quantity: 1, unitPrice: '110.00' },
    ],
    orderStatus: ORDER_STATUSES.INITIATED,
    paymentStatus: PAYMENT_STATUSES.PENDING,
    statusLogs: [
      { previousStatus: null, newStatus: ORDER_STATUSES.INITIATED, reason: 'Order created via QR' },
    ],
  },

  {
    cinema: 'inox-malad',
    screen: 2,
    seatNumber: null,
    filmTitle: null,
    showTime: null,
    customerMobile: '9123456790',
    source: 'counter',
    items: [
      { productId: null, productName: 'Nachos Grande', quantity: 1, unitPrice: '220.00' },
    ],
    orderStatus: ORDER_STATUSES.REJECTED,
    paymentStatus: PAYMENT_STATUSES.PENDING,
    statusLogs: [
      { previousStatus: null, newStatus: ORDER_STATUSES.INITIATED, reason: 'Order created at counter' },
      { previousStatus: ORDER_STATUSES.INITIATED, newStatus: ORDER_STATUSES.REJECTED, reason: 'Customer cancelled' },
    ],
  },

  // --- Counter orders (no screenId/filmTitle)
  {
    cinema: 'pvr-andheri',
    screen: null,
    seatNumber: null,
    filmTitle: null,
    showTime: null,
    customerMobile: '9876543214',
    source: 'counter',
    items: [
      { productId: null, productName: 'French Fries', quantity: 2, unitPrice: '120.00' },
      { productId: null, productName: 'Coca-Cola (Regular)', quantity: 2, unitPrice: '100.00' },
    ],
    orderStatus: ORDER_STATUSES.CONFIRMED,
    paymentStatus: PAYMENT_STATUSES.PAID,
    statusLogs: [
      { previousStatus: null, newStatus: ORDER_STATUSES.INITIATED, reason: 'Order created' },
      { previousStatus: ORDER_STATUSES.INITIATED, newStatus: ORDER_STATUSES.CONFIRMED, reason: 'Confirmed' },
    ],
  },
];

/**
 * Create sample orders with realistic status workflows.
 *
 * Orders are inserted directly into the database to avoid the complex pricing
 * validation in the order service. Each order:
 * 1. Gets created at 'initiated' / 'pending' status
 * 2. Has status log entries for each workflow transition
 * 3. May have payment status transitions
 * 4. Includes screenId and filmTitle for UI testing
 *
 * @param {Map} cinemaIds Map of cinema slugs to database IDs (from seed-dev-data)
 * @returns {Promise<number>} Number of orders created
 */
async function seedOrders(cinemaIds) {
  let ordersCreated = 0;

  for (const orderSpec of SAMPLE_ORDERS) {
    try {
      const cinemaId = cinemaIds?.get(orderSpec.cinema);

      if (!cinemaId) {
        console.error(`  ✗ Cinema ID for "${orderSpec.cinema}" not found`);
        continue;
      }

      const screen = orderSpec.screen
        ? await models.Screen.findOne({
            where: { cinemaId, name: `Screen ${orderSpec.screen}` },
            attributes: ['id'],
            raw: true,
          })
        : null;

      // Get status IDs
      const initiatedStatus = await models.OrderStatus.findOne({
        where: { code: ORDER_STATUSES.INITIATED },
        attributes: ['id'],
        raw: true,
      });

      const pendingStatus = await models.PaymentStatus.findOne({
        where: { code: PAYMENT_STATUSES.PENDING },
        attributes: ['id'],
        raw: true,
      });

      const finalOrderStatus = await models.OrderStatus.findOne({
        where: { code: orderSpec.orderStatus },
        attributes: ['id'],
        raw: true,
      });

      const finalPaymentStatus = await models.PaymentStatus.findOne({
        where: { code: orderSpec.paymentStatus },
        attributes: ['id'],
        raw: true,
      });

      // Create the order starting at initiated/pending
      const order = await models.Order.create({
        cinemaId,
        screenId: screen?.id || null,
        seatNumber: orderSpec.seatNumber || null,
        statusId: initiatedStatus.id,
        source: orderSpec.source || null,
        customerMobile: orderSpec.customerMobile || null,
        customerEmail: orderSpec.customerEmail || null,
        filmTitle: orderSpec.filmTitle || null,
        showTime: orderSpec.showTime || null,
        subtotal: '0.00', // Would be calculated by service, set to 0 for seed
        discount: '0.00',
        total: '0.00',
        paymentStatusId: pendingStatus.id,
        notes: orderSpec.notes || null,
        deliveredAt: orderSpec.deliveredAt || null,
      });

      // Create order items (simplified - no product ID resolution for seed)
      await models.OrderItem.bulkCreate(
        orderSpec.items.map((item) => ({
          orderId: order.id,
          productId: item.productId || null,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: '0.00',
          total: String(parseFloat(item.unitPrice) * item.quantity),
        }))
      );

      // Create status logs for workflow
      if (orderSpec.statusLogs && orderSpec.statusLogs.length > 0) {
        for (const log of orderSpec.statusLogs) {
          const previousStatus =
            log.previousStatus && log.previousStatus !== null
              ? await models.OrderStatus.findOne({
                  where: { code: log.previousStatus },
                  attributes: ['id'],
                  raw: true,
                })
              : null;

          const newStatus = await models.OrderStatus.findOne({
            where: { code: log.newStatus },
            attributes: ['id'],
            raw: true,
          });

          await models.OrderStatusLog.create({
            orderId: order.id,
            previousStatusId: previousStatus?.id || null,
            newStatusId: newStatus.id,
            changedByUserId: null, // Seeded orders have no creator
            reason: log.reason || null,
          });
        }

        // Update order to final status
        await order.update({ statusId: finalOrderStatus.id });
      }

      // Create payment status logs if payment status changed
      if (orderSpec.paymentStatus !== PAYMENT_STATUSES.PENDING) {
        await models.PaymentStatusLog.create({
          orderId: order.id,
          previousStatusId: pendingStatus.id,
          newStatusId: finalPaymentStatus.id,
          changedByUserId: null,
          reason: `Payment ${orderSpec.paymentStatus}`,
        });

        await order.update({ paymentStatusId: finalPaymentStatus.id });
      }

      ordersCreated++;
    } catch (error) {
      console.error(`  ✗ Failed to seed order: ${error.message}`);
    }
  }

  return ordersCreated;
}

module.exports = { seedOrders, SAMPLE_ORDERS };

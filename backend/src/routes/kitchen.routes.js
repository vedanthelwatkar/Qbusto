'use strict';

/**
 * Kitchen Display System routes, mounted at /api/kitchen.
 *
 * WHY THIS ROUTER EXISTS AND /api/orders WAS NOT REUSED
 *
 * The staff order API can filter to one status; a kitchen board needs three at
 * once, and more importantly it needs a rule it cannot be talked out of. On
 * /api/orders the payment filter is an optional query parameter, so "only paid
 * orders" would be a client's promise. Here it is the service's, applied to
 * every read and every write. A KDS that shows an unpaid order is food given
 * away, so that guard belongs on the server, in one place, with no parameter
 * that turns it off.
 *
 * What this router does NOT do is re-implement anything. Transitions go
 * through fulfilment.service, the same function /api/orders calls, so a status
 * set from a kitchen screen and one set from the Dashboard are the same write.
 *
 * PERMISSIONS
 *
 * The frozen permission schema has no Kitchen module, and adding one would mean
 * a migration plus a change to a CHECK constraint for no behavioural gain -
 * these endpoints are about orders. So they use the Orders module: `read` for
 * the board, `edit` to move an order along. A kitchen_staff account is
 * therefore provisioned with Orders read+edit and nothing else, which is the
 * narrowest grant that lets it work.
 */

const express = require('express');

const kitchenController = require('../controllers/kitchen.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const kitchenValidators = require('../validators/kitchen.validators');
const { MODULES, ACTIONS } = require('../constants');

const router = express.Router();

// Applies to every route below; each still declares its own permission.
router.use(authenticate());

/**
 * @openapi
 * /api/kitchen/orders:
 *   get:
 *     tags: [Kitchen]
 *     summary: List orders the kitchen is responsible for
 *     description: >
 *       The KDS board. Returns only orders that are **paid** and in a
 *       fulfilment status the kitchen owns - this is enforced server-side and
 *       there is no parameter that relaxes it, so an unpaid or rejected order
 *       can never appear on a kitchen screen.
 *
 *
 *       `scope=active` (the default) returns work still outstanding:
 *       `confirmed`, `preparing`, `ready`. `scope=completed` returns
 *       `delivered`. `scope=all` returns both in one request.
 *
 *
 *       Sorted oldest-first by default, because a kitchen works a queue.
 *       `search` matches seat number, film title, or the order id exactly.
 *       Non-owners see only orders placed at cinemas in their own chain.
 *       Requires the Orders module read permission.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *       - in: query
 *         name: scope
 *         schema: { type: string, enum: [active, completed, all], default: active }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [placedAt, showTime, id], default: placedAt }
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc], default: asc }
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 200 }
 *       - in: query
 *         name: cinemaId
 *         schema: { type: integer }
 *       - in: query
 *         name: screenId
 *         schema: { type: integer }
 *       - in: query
 *         name: status
 *         description: Narrow to one kitchen queue.
 *         schema: { type: string, enum: [confirmed, preparing, ready, delivered] }
 *     responses:
 *       200:
 *         description: Eligible orders
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/KitchenOrder' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  '/orders',
  authorize(MODULES.ORDERS, ACTIONS.READ),
  validate(kitchenValidators.list),
  kitchenController.list
);

/**
 * @openapi
 * /api/kitchen/orders/{id}:
 *   get:
 *     tags: [Kitchen]
 *     summary: Get one kitchen order in full
 *     description: >
 *       The focused ticket view. The same eligibility rule as the board is
 *       applied here, so an order that exists but is unpaid, rejected, or in
 *       another chain is reported as **404** rather than 403 - the kitchen has
 *       no business learning that such an order exists.
 *       Requires the Orders module read permission.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The order
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/KitchenOrder' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  '/orders/:id',
  authorize(MODULES.ORDERS, ACTIONS.READ),
  validate(kitchenValidators.getById),
  kitchenController.getById
);

/**
 * @openapi
 * /api/kitchen/orders/{id}/status:
 *   patch:
 *     tags: [Kitchen]
 *     summary: Move an order along the kitchen workflow
 *     description: >
 *       Applies one forward step of the fulfilment graph:
 *       `confirmed -> preparing -> ready -> delivered`. The move is validated
 *       against the order's **current** status on the server, so a stale
 *       screen cannot skip a step.
 *
 *
 *       The kitchen may only set `preparing`, `ready` or `delivered`.
 *       `rejected` is a commercial decision that belongs to the Dashboard, and
 *       `confirmed` is set by payment rather than by a person.
 *
 *
 *       Requesting the status the order is already in is a no-op and returns
 *       **200** with no new audit entry - two screens pressing the same button
 *       is a race, not an error. A move that lost such a race, or one that is
 *       illegal from the current status, returns **409** with the statuses the
 *       order could legally reach; the client should replace its copy with the
 *       server's. Requires the Orders module edit permission.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [preparing, ready, delivered]
 *               reason:
 *                 type: string
 *                 maxLength: 500
 *                 nullable: true
 *     responses:
 *       200:
 *         description: The order as it now stands
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/KitchenOrder' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { $ref: '#/components/responses/Conflict' }
 */
router.patch(
  '/orders/:id/status',
  authorize(MODULES.ORDERS, ACTIONS.EDIT),
  validate(kitchenValidators.updateStatus),
  kitchenController.updateStatus
);

module.exports = router;

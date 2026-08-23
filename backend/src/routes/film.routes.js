'use strict';

/**
 * Film routes, mounted at /api/films.
 *
 * Read-only. The film catalogue lives in the client's `film` table and is
 * synced from their source system, so QBusto reads it and does not write it.
 *
 * PERMISSIONS
 *
 * Authorised against Settings, the module that already covers chains, cinemas
 * and screens. The permission model's module list mirrors a CHECK constraint
 * on the frozen schema, so adding a module is a schema change and is not
 * warranted when an exact precedent exists.
 */

const express = require('express');

const filmController = require('../controllers/film.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const filmValidators = require('../validators/film.validators');
const { MODULES, ACTIONS } = require('../constants');

const router = express.Router();

router.use(authenticate());

/**
 * @openapi
 * /api/films:
 *   get:
 *     tags: [Films]
 *     summary: List films
 *     description: >
 *       The film catalogue as the source system supplies it. Shared across
 *       every cinema and not tenant-scoped. Read-only.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Matches the title.
 *       - in: query
 *         name: nowShowingFlag
 *         schema: { type: string, maxLength: 1 }
 *         description: >
 *           Exact match on the source system's raw now-showing flag. Not
 *           interpreted - the client's data has never contained a 'Y' value,
 *           so no boolean meaning is assumed here. Pass the exact stored
 *           character to filter on it.
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [code, title, certification, durationMinutes, openingDate]
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc] }
 *     responses:
 *       200:
 *         description: Films
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Film'
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  '/',
  authorize(MODULES.SETTINGS, ACTIONS.READ),
  validate(filmValidators.list),
  filmController.list
);

/**
 * @openapi
 * /api/films/{code}:
 *   get:
 *     tags: [Films]
 *     summary: Get one film by its source-system code
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema: { type: string, maxLength: 20 }
 *         description: The source system's film code, e.g. HO00012070.
 *     responses:
 *       200:
 *         description: Film
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Film'
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  '/:code',
  authorize(MODULES.SETTINGS, ACTIONS.READ),
  validate(filmValidators.getByCode),
  filmController.getByCode
);

module.exports = router;

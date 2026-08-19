'use strict';

/**
 * User management.
 *
 * Two rules run through every function here:
 *
 *   1. Tenant scope. Only an `owner` sees across chains. Every other role is
 *      confined to their own chain_id, so a chain_admin cannot read or modify a
 *      user belonging to another chain. Out-of-scope ids are reported as 404
 *      rather than 403 - confirming a row exists is itself a leak.
 *
 *   2. Nothing leaves this module that has not been through serializeUser(),
 *      which copies a fixed attribute list and therefore cannot accidentally
 *      carry passwordHash into a response.
 *
 * Deletion is soft: is_active is set to 0 and the row stays. Permission rows are
 * left in place so reactivating a user restores their previous access.
 */

const { Op } = require('sequelize');

const { sequelize, models } = require('../config/database');
const { NotFoundError, ConflictError, AuthorizationError } = require('../utils/errors');
const { ROLES, ACTION_ATTRIBUTE } = require('../constants');

/** The only user columns that may be sent to a client. */
const PUBLIC_ATTRIBUTES = [
  'id',
  'chainId',
  'cinemaId',
  'role',
  'username',
  'firstName',
  'lastName',
  'mobile',
  'isActive',
  'createdAt',
  'updatedAt',
];

const PERMISSION_ATTRIBUTES = ['moduleName', 'canRead', 'canEdit', 'canDelete'];

const PERMISSIONS_INCLUDE = {
  association: 'permissions',
  attributes: PERMISSION_ATTRIBUTES,
};

function serializePermission(permission) {
  return {
    moduleName: permission.moduleName,
    canRead: permission.canRead,
    canEdit: permission.canEdit,
    canDelete: permission.canDelete,
  };
}

/**
 * Build the client-facing shape of a user. `permissions` is included only when
 * the caller loaded the association.
 *
 * @param {object} user User instance, or any object with the same attributes.
 * @returns {object|null}
 */
function serializeUser(user) {
  if (!user) return null;

  const result = {};
  for (const attribute of PUBLIC_ATTRIBUTES) {
    result[attribute] = user[attribute];
  }

  if (user.permissions) {
    result.permissions = user.permissions.map(serializePermission);
  }

  return result;
}

/** Extra `where` clause confining non-owners to their own chain. */
function tenantScope(actor) {
  return actor.role === ROLES.OWNER ? {} : { chainId: actor.chainId };
}

/**
 * Only an owner may hand out the owner role.
 *
 * Roles are identities, not ranks - which role a user holds says nothing about
 * what they may do, because access comes from user_permissions. `owner` is the
 * single exception: it bypasses the permission table entirely (see
 * middleware/authorize), so granting it is the one role assignment that cannot
 * be delegated. No other role is restricted, and no two roles are compared.
 *
 * Applies to create and update alike: becoming an owner is becoming an owner
 * whichever endpoint does it.
 *
 * @throws {AuthorizationError} 403 when a non-owner tries to assign `owner`.
 */
function assertMayAssignOwnerRole(actor, role) {
  if (role !== ROLES.OWNER || actor.role === ROLES.OWNER) return;

  throw new AuthorizationError('Only an owner may assign the owner role', undefined, {
    requestedRole: role,
  });
}

/**
 * Only an owner may modify an owner's account.
 *
 * Covers updates, permission changes and deactivation: all three go through a
 * loaded target, and all three are refused when that target is an owner and the
 * actor is not. Again a single comparison against one role - non-owner targets
 * are governed purely by the Users permission.
 *
 * @throws {AuthorizationError} 403 when a non-owner targets an owner.
 */
function assertMayModifyOwner(actor, target) {
  if (target.role !== ROLES.OWNER || actor.role === ROLES.OWNER) return;

  throw new AuthorizationError('Only an owner may modify an owner account', undefined, {
    targetUserId: target.id,
  });
}

/**
 * Nobody may grant a permission they do not hold themselves.
 *
 * Owners are exempt: they bypass the permission table by design, so there is
 * nothing to compare against.
 *
 * @throws {AuthorizationError} 403 listing every flag that was refused.
 */
function assertMayGrantPermissions(actor, permissions) {
  if (!permissions || actor.role === ROLES.OWNER) return;

  const held = new Map((actor.permissions || []).map((entry) => [entry.moduleName, entry]));
  const denied = [];

  for (const requested of permissions) {
    const heldForModule = held.get(requested.moduleName);

    for (const attribute of Object.values(ACTION_ATTRIBUTE)) {
      const isGranting = requested[attribute] === true;
      const actorHolds = Boolean(heldForModule && heldForModule[attribute] === true);

      if (isGranting && !actorHolds) {
        denied.push({ module: requested.moduleName, permission: attribute });
      }
    }
  }

  if (denied.length > 0) {
    throw new AuthorizationError(
      'You may only grant permissions that you hold yourself',
      undefined,
      denied
    );
  }
}

/**
 * A user may only be attached to a cinema inside their own chain.
 *
 * `users.cinema_id` has a foreign key to `cinemas.id` and nothing more, so the
 * database will happily attach a chain A user to a chain B cinema. This is the
 * same tenant gap that the cinema_categories and cinema_products hooks guard,
 * enforced here because the frozen User model has no equivalent hook.
 *
 * @throws {ConflictError} 409 when the cinema belongs to a different chain.
 */
async function assertCinemaInChain(cinemaId, chainId, transaction) {
  if (cinemaId === undefined || cinemaId === null) return;

  const cinema = await models.Cinema.findByPk(cinemaId, {
    attributes: ['id', 'chainId'],
    transaction,
  });

  // A missing cinema is left to the foreign key to reject, matching how the
  // cross-tenant model hooks handle the same case.
  if (!cinema) return;

  if (cinema.chainId !== chainId) {
    throw new ConflictError('The selected cinema belongs to a different chain', {
      cinemaId: cinema.id,
      cinemaChainId: cinema.chainId,
      userChainId: chainId,
    });
  }
}

/**
 * Replace a user's permission rows wholesale.
 *
 * Delete-then-insert rather than a per-row diff: the set is at most ten rows,
 * and "the rows in the request are the rows that exist" is far easier to reason
 * about than a merge. Always called inside a transaction so a user is never left
 * with no permissions because the insert failed.
 */
async function replacePermissions(userId, permissions, actorId, transaction) {
  await models.UserPermission.destroy({ where: { userId }, transaction });

  if (permissions.length === 0) return;

  await models.UserPermission.bulkCreate(
    permissions.map((permission) => ({
      ...permission,
      userId,
      createdBy: actorId,
      updatedBy: actorId,
    })),
    { transaction }
  );
}

/**
 * Paginated, filtered user list.
 *
 * @param {object} actor  The authenticated user making the request.
 * @param {object} query  Validated query params.
 * @returns {Promise<{users: object[], total: number}>}
 */
async function listUsers(actor, { page, limit, sort, order, search, role, isActive, cinemaId }) {
  const where = { ...tenantScope(actor) };

  if (role) where.role = role;
  if (isActive !== undefined) where.isActive = isActive;
  if (cinemaId) where.cinemaId = cinemaId;

  if (search) {
    where[Op.or] = [
      { username: { [Op.like]: `%${search}%` } },
      { firstName: { [Op.like]: `%${search}%` } },
      { lastName: { [Op.like]: `%${search}%` } },
    ];
  }

  const { rows, count } = await models.User.findAndCountAll({
    where,
    attributes: PUBLIC_ATTRIBUTES,
    order: [[sort, order.toUpperCase()]],
    limit,
    offset: (page - 1) * limit,
  });

  return { users: rows.map(serializeUser), total: count };
}

/**
 * A single user with their permissions.
 *
 * @throws {NotFoundError} When the id does not exist, or is outside the actor's
 *   chain.
 */
async function getUser(actor, userId) {
  const user = await models.User.findOne({
    where: { id: userId, ...tenantScope(actor) },
    attributes: PUBLIC_ATTRIBUTES,
    include: [PERMISSIONS_INCLUDE],
  });

  if (!user) throw new NotFoundError('User');

  return serializeUser(user);
}

/**
 * Load a user for modification. Unlike getUser this returns the instance with
 * every column loaded - a partially loaded instance would fail model validation
 * on save.
 */
async function findForUpdate(actor, userId, transaction) {
  const user = await models.User.findOne({
    where: { id: userId, ...tenantScope(actor) },
    transaction,
  });

  if (!user) throw new NotFoundError('User');

  return user;
}

/**
 * Create a user and their permissions atomically.
 *
 * A duplicate username is left to the UQ_users_username constraint, which the
 * error handler turns into a 409 - checking first would only add a query and
 * still lose a race.
 */
async function createUser(actor, payload) {
  const { permissions = [], chainId, ...attributes } = payload;

  // Only an owner may place a user in another chain; anyone else creates within
  // their own, whatever the request body said.
  const targetChainId = actor.role === ROLES.OWNER ? (chainId ?? actor.chainId) : actor.chainId;

  // Checked before the transaction opens: these depend only on the request and
  // the actor, so there is no reason to hold a transaction open to reject them.
  assertMayAssignOwnerRole(actor, attributes.role);
  assertMayGrantPermissions(actor, permissions);

  const createdId = await sequelize.transaction(async (transaction) => {
    await assertCinemaInChain(attributes.cinemaId, targetChainId, transaction);

    // `password` is virtual: the model's beforeValidate hook hashes it into
    // passwordHash, so no plaintext is ever passed to the database.
    const user = await models.User.create(
      { ...attributes, chainId: targetChainId },
      { transaction }
    );

    await replacePermissions(user.id, permissions, actor.id, transaction);

    return user.id;
  });

  return getUser(actor, createdId);
}

/**
 * Update a user, and replace their permissions when the request includes them.
 * Both happen in one transaction so a user can never end up with the new role
 * but the old permissions.
 */
async function updateUser(actor, userId, payload) {
  const { permissions, ...attributes } = payload;
  const isSelf = Number(userId) === actor.id;

  if (isSelf && attributes.isActive === false) {
    throw new ConflictError('You cannot deactivate your own account');
  }

  assertMayAssignOwnerRole(actor, attributes.role);
  assertMayGrantPermissions(actor, permissions);

  await sequelize.transaction(async (transaction) => {
    const user = await findForUpdate(actor, userId, transaction);

    // Needs the loaded row: whether the target is an owner is not knowable from
    // the request. Covers attribute changes and permission replacement alike.
    assertMayModifyOwner(actor, user);

    await assertCinemaInChain(attributes.cinemaId, user.chainId, transaction);

    if (Object.keys(attributes).length > 0) {
      await user.update(attributes, { transaction });
    }

    if (permissions) {
      await replacePermissions(user.id, permissions, actor.id, transaction);
    }
  });

  return getUser(actor, userId);
}

/**
 * Soft delete: is_active becomes 0. The row is never removed - orders, status
 * logs and audit columns all reference it.
 *
 * Idempotent, and no transaction: this is a single-row write.
 */
async function deactivateUser(actor, userId) {
  // Self-deactivation would lock the actor out mid-request, and if they are the
  // last active administrator, lock everyone out.
  if (Number(userId) === actor.id) {
    throw new ConflictError('You cannot deactivate your own account');
  }

  const user = await findForUpdate(actor, userId);

  assertMayModifyOwner(actor, user);

  if (user.isActive) {
    await user.update({ isActive: false });
  }

  return serializeUser(user);
}

module.exports = {
  listUsers,
  getUser,
  createUser,
  updateUser,
  deactivateUser,
  serializeUser,
  PUBLIC_ATTRIBUTES,
  PERMISSION_ATTRIBUTES,
};

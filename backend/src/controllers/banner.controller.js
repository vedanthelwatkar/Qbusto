'use strict';

/**
 * Banner endpoints.
 *
 * `req.user` is passed into every service call as the acting user: the service
 * uses it for tenant scoping and for the created_by / updated_by audit columns.
 */

const bannerService = require('../services/banner.service');
const { success, paginated } = require('../utils/response');

async function list(req, res) {
  const { page, limit } = req.validated.query;

  const { banners, total } = await bannerService.listBanners(req.user, req.validated.query);

  return paginated(res, { data: banners, total, page, limit, message: 'Banners retrieved' });
}

async function getById(req, res) {
  const banner = await bannerService.getBanner(req.user, req.validated.params.id);

  return success(res, { message: 'Banner retrieved', data: banner });
}

async function create(req, res) {
  const banner = await bannerService.createBanner(req.user, req.validated.body);

  return success(res, { message: 'Banner created', data: banner, statusCode: 201 });
}

async function update(req, res) {
  const banner = await bannerService.updateBanner(
    req.user,
    req.validated.params.id,
    req.validated.body
  );

  return success(res, { message: 'Banner updated', data: banner });
}

/** Soft delete - the row stays and is_active becomes 0. */
async function remove(req, res) {
  const banner = await bannerService.deactivateBanner(req.user, req.validated.params.id);

  return success(res, { message: 'Banner deactivated', data: banner });
}

module.exports = { list, getById, create, update, remove };

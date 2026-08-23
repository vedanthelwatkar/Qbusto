'use strict';

/**
 * Image upload endpoint.
 *
 * Thin, like every other controller here. The entity has already been checked
 * by the route's validator and the caller's permission by authorize(); what is
 * left is to hand the bytes to the service and return the value the client
 * should store on the record.
 */

const uploadService = require('../services/upload.service');
const { success } = require('../utils/response');
const { ValidationError } = require('../utils/errors');
const { FILE_FIELD } = require('../middleware/upload');

async function uploadImage(req, res) {
  if (!req.file || !req.file.buffer) {
    throw new ValidationError('No image was uploaded', [
      { field: FILE_FIELD, message: `Attach the image in the "${FILE_FIELD}" field` },
    ]);
  }

  // Set by the route, never by the request.
  const entity = req.uploadEntity;

  const stored = await uploadService.storeImage(entity, req.file.buffer);

  return success(res, {
    statusCode: 201,
    message: 'Image uploaded',
    // `path` is what belongs in the record's image column. No filesystem
    // location is returned - the client has no use for one and exposing it
    // would leak the server's layout.
    data: { path: stored.path, mimeType: stored.mime, bytes: stored.bytes },
  });
}

module.exports = { uploadImage };

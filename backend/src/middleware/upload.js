'use strict';

/**
 * Multipart parsing for image uploads.
 *
 * Memory storage on purpose: the bytes are validated by upload.service before
 * anything touches the disk. multer's own disk storage would write the file
 * first and leave an unvalidated object inside a directory the application
 * serves, however briefly.
 *
 * The 5 MB default ceiling (MAX_UPLOAD_SIZE_MB) is enforced by multer as the
 * stream is read, so an oversized upload is abandoned rather than buffered in
 * full and rejected afterwards.
 */

const multer = require('multer');

const env = require('../config/env');
const { ValidationError } = require('../utils/errors');

/** The form field carrying the file. */
const FILE_FIELD = 'file';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.uploads.maxBytes,
    // One file, one field. Without these a request could carry hundreds of
    // parts and multer would parse them all before any handler ran.
    files: 1,
    fields: 5,
    parts: 10,
  },
  /**
   * A cheap first filter on the declared type.
   *
   * This is NOT the security boundary - the client chooses this header, so it
   * can be set to `image/png` on a shell script. It exists so an obviously
   * wrong upload fails before it is buffered. The real check is the magic-byte
   * inspection in upload.service.
   */
  fileFilter(req, file, callback) {
    if (typeof file.mimetype === 'string' && file.mimetype.startsWith('image/')) {
      callback(null, true);
      return;
    }
    callback(
      new ValidationError('Only image files can be uploaded', [
        { field: FILE_FIELD, message: `Received content type "${file.mimetype}"` },
      ])
    );
  },
});

/**
 * Parse one image, translating multer's own failures into the API's error
 * envelope.
 *
 * Without this, a file over the limit surfaces as an unhandled MulterError and
 * the shared handler reports 500 for what is a client mistake.
 */
function uploadSingleImage() {
  const parser = upload.single(FILE_FIELD);

  return function uploadMiddleware(req, res, next) {
    parser(req, res, (error) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof multer.MulterError) {
        const messages = {
          LIMIT_FILE_SIZE: `The image must be ${env.uploads.maxSizeMb} MB or smaller`,
          LIMIT_FILE_COUNT: 'Upload one image at a time',
          LIMIT_UNEXPECTED_FILE: `The file must be sent in the "${FILE_FIELD}" field`,
        };

        next(
          new ValidationError(messages[error.code] || 'The upload could not be read', [
            { field: FILE_FIELD, message: messages[error.code] || error.code },
          ])
        );
        return;
      }

      next(error);
    });
  };
}

module.exports = { uploadSingleImage, FILE_FIELD };

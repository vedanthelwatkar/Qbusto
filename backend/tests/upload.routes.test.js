'use strict';

/**
 * End-to-end tests for /api/uploads.
 *
 * The filesystem is mocked so these assert the decisions the code makes -
 * which files are accepted, what they are named, where they are written and
 * who is allowed to write them - rather than exercising real disk I/O.
 *
 * The content tests are the important ones. Every rejection here is a file
 * that declared `image/png` and would have been written under a directory the
 * application serves.
 */

const request = require('supertest');

jest.mock('../src/config/database', () => ({
  models: { User: { findByPk: jest.fn() } },
  sequelize: { transaction: jest.fn(), query: jest.fn(), authenticate: jest.fn() },
  Sequelize: {},
}));

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

const fs = require('fs/promises');
const { models } = require('../src/config/database');
const createApp = require('../src/app');
const { generateAccessToken } = require('../src/utils/jwt');
const uploadService = require('../src/services/upload.service');

const app = createApp();

/** Smallest byte sequences that carry each format's signature. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(64, 1)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.alloc(4, 0),
  Buffer.from('WEBP', 'latin1'),
  Buffer.alloc(64, 1),
]);

/** A shell script and a Windows executable, both claiming to be images. */
const SHELL = Buffer.from('#!/bin/sh\nrm -rf /\n', 'utf8');
const EXE = Buffer.concat([Buffer.from('MZ', 'latin1'), Buffer.alloc(64, 0)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 'utf8');

function actorWith(permissions, role = 'cinema_admin') {
  return {
    id: 7,
    chainId: 1,
    cinemaId: null,
    role,
    username: 'alice',
    isActive: true,
    permissions,
  };
}

function authenticateAs(actor) {
  models.User.findByPk.mockResolvedValue(actor);
  return `Bearer ${generateAccessToken({ sub: actor.id, role: actor.role })}`;
}

const ALL_EDIT = [
  { moduleName: 'Banners', canRead: true, canEdit: true, canDelete: false },
  { moduleName: 'Categories', canRead: true, canEdit: true, canDelete: false },
  { moduleName: 'Products', canRead: true, canEdit: true, canDelete: false },
  { moduleName: 'Settings', canRead: true, canEdit: true, canDelete: false },
];

beforeEach(() => {
  fs.mkdir.mockResolvedValue(undefined);
  fs.writeFile.mockResolvedValue(undefined);
  fs.unlink.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe('upload authorization', () => {
  it('rejects an unauthenticated upload', async () => {
    const response = await request(app).post('/api/uploads/products').attach('file', PNG, 'a.png');

    expect(response.status).toBe(401);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('requires edit on the module that owns the entity', async () => {
    // Read-only on Products: enough to see them, not to add files for them.
    const token = authenticateAs(
      actorWith([{ moduleName: 'Products', canRead: true, canEdit: false, canDelete: false }])
    );

    const response = await request(app)
      .post('/api/uploads/products')
      .set('Authorization', token)
      .attach('file', PNG, 'a.png');

    expect(response.status).toBe(403);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('does not let edit on one module authorise another', async () => {
    const token = authenticateAs(
      actorWith([{ moduleName: 'Banners', canRead: true, canEdit: true, canDelete: false }])
    );

    await expect(
      request(app)
        .post('/api/uploads/banners')
        .set('Authorization', token)
        .attach('file', PNG, 'a.png')
    ).resolves.toMatchObject({ status: 201 });

    const denied = await request(app)
      .post('/api/uploads/products')
      .set('Authorization', token)
      .attach('file', PNG, 'a.png');

    expect(denied.status).toBe(403);
  });

  it('maps chains to the Settings module', async () => {
    const token = authenticateAs(
      actorWith([{ moduleName: 'Settings', canRead: true, canEdit: true, canDelete: false }])
    );

    const response = await request(app)
      .post('/api/uploads/chains')
      .set('Authorization', token)
      .attach('file', PNG, 'logo.png');

    expect(response.status).toBe(201);
  });

  it('has no route for an entity outside the allowlist', async () => {
    const token = authenticateAs(actorWith(ALL_EDIT, 'owner'));

    const response = await request(app)
      .post('/api/uploads/users')
      .set('Authorization', token)
      .attach('file', PNG, 'a.png');

    expect(response.status).toBe(404);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// What is accepted
// ---------------------------------------------------------------------------

describe('upload content validation', () => {
  let token;

  beforeEach(() => {
    token = authenticateAs(actorWith(ALL_EDIT));
  });

  it.each([
    ['PNG', PNG, 'png', 'image/png'],
    ['JPEG', JPEG, 'jpg', 'image/jpeg'],
    ['GIF', GIF, 'gif', 'image/gif'],
    ['WebP', WEBP, 'webp', 'image/webp'],
  ])('accepts a real %s', async (_label, bytes, ext, mime) => {
    const response = await request(app)
      .post('/api/uploads/products')
      .set('Authorization', token)
      .attach('file', bytes, `whatever.${ext}`);

    expect(response.status).toBe(201);
    expect(response.body.data.mimeType).toBe(mime);
    expect(response.body.data.path).toMatch(
      new RegExp(`^/uploads/products/[a-f0-9]{32}\\.${ext}$`)
    );
  });

  it.each([
    ['a shell script', SHELL],
    ['a Windows executable', EXE],
    ['an SVG, which can carry script', SVG],
  ])('rejects %s even when it is named .png and declared image/png', async (_label, bytes) => {
    const response = await request(app)
      .post('/api/uploads/products')
      .set('Authorization', token)
      .attach('file', bytes, { filename: 'innocent.png', contentType: 'image/png' });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/not a supported image/i);
    // Nothing reached the disk: the bytes are checked while still in memory.
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('rejects a file whose declared type is not an image at all', async () => {
    const response = await request(app)
      .post('/api/uploads/products')
      .set('Authorization', token)
      .attach('file', SHELL, { filename: 'x.sh', contentType: 'application/x-sh' });

    expect(response.status).toBe(400);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('rejects a request carrying no file', async () => {
    const response = await request(app).post('/api/uploads/products').set('Authorization', token);

    expect(response.status).toBe(400);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('rejects a file too small to carry a signature', async () => {
    const response = await request(app)
      .post('/api/uploads/products')
      .set('Authorization', token)
      .attach('file', Buffer.from([0xff, 0xd8]), { filename: 'a.png', contentType: 'image/png' });

    expect(response.status).toBe(400);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Naming and placement
// ---------------------------------------------------------------------------

describe('stored filename and location', () => {
  let token;

  beforeEach(() => {
    token = authenticateAs(actorWith(ALL_EDIT));
  });

  it('ignores the uploaded filename entirely', async () => {
    const response = await request(app)
      .post('/api/uploads/products')
      .set('Authorization', token)
      .attach('file', PNG, { filename: '../../../../etc/passwd.png', contentType: 'image/png' });

    expect(response.status).toBe(201);
    // Server-generated: no part of the submitted name survives, so traversal
    // through the filename is not merely sanitised, it is impossible.
    expect(response.body.data.path).toMatch(/^\/uploads\/products\/[a-f0-9]{32}\.png$/);

    const written = fs.writeFile.mock.calls[0][0];
    expect(written).not.toContain('..');
    expect(written).not.toContain('passwd');
  });

  it('writes beneath the configured storage root, in the entity folder', async () => {
    await request(app)
      .post('/api/uploads/categories')
      .set('Authorization', token)
      .attach('file', PNG, 'a.png');

    const dir = fs.mkdir.mock.calls[0][0];
    const file = fs.writeFile.mock.calls[0][0];

    expect(dir).toBe(uploadService.entityDir('categories'));
    expect(file.startsWith(uploadService.entityDir('categories'))).toBe(true);
  });

  it('refuses to overwrite an existing file', async () => {
    // `wx` is what makes a name collision fail instead of replacing a file
    // another record already points at.
    expect(fs.writeFile.mock.calls.length).toBe(0);

    await request(app)
      .post('/api/uploads/products')
      .set('Authorization', token)
      .attach('file', PNG, 'a.png');

    expect(fs.writeFile.mock.calls[0][2]).toEqual({ flag: 'wx' });
  });

  it('never returns a filesystem path', async () => {
    const response = await request(app)
      .post('/api/uploads/products')
      .set('Authorization', token)
      .attach('file', PNG, 'a.png');

    const body = JSON.stringify(response.body);
    expect(body).not.toContain(uploadService.entityDir('products'));
    expect(response.body.data.path.startsWith('/uploads/')).toBe(true);
  });

  it('generates a different name for identical bytes', async () => {
    const first = await request(app)
      .post('/api/uploads/products')
      .set('Authorization', token)
      .attach('file', PNG, 'a.png');
    const second = await request(app)
      .post('/api/uploads/products')
      .set('Authorization', token)
      .attach('file', PNG, 'a.png');

    expect(first.body.data.path).not.toBe(second.body.data.path);
  });
});

// ---------------------------------------------------------------------------
// Recognising a stored value
// ---------------------------------------------------------------------------

describe('isLocalUpload', () => {
  it.each([
    '/uploads/products/0123456789abcdef0123456789abcdef.png',
    '/uploads/banners/0123456789abcdef0123456789abcdef.webp',
  ])('recognises %s as a local upload', (value) => {
    expect(uploadService.isLocalUpload(value)).toBe(true);
  });

  it.each([
    ['an external URL', 'https://example.com/image.jpg'],
    ['an external URL that mentions uploads', 'https://evil.test/uploads/products/a.png'],
    ['a protocol-relative URL', '//evil.test/uploads/products/a.png'],
    ['a traversal attempt', '/uploads/products/../../../etc/passwd'],
    ['an unknown entity folder', '/uploads/secrets/0123456789abcdef0123456789abcdef.png'],
    ['a non-image extension', '/uploads/products/0123456789abcdef0123456789abcdef.exe'],
    ['a non-generated filename', '/uploads/products/logo.png'],
    ['an empty value', ''],
    ['null', null],
  ])('does not treat %s as a local upload', (_label, value) => {
    expect(uploadService.isLocalUpload(value)).toBe(false);
  });

  it('never deletes anything that is not a local upload', async () => {
    for (const value of ['https://example.com/a.jpg', '/uploads/products/../../x', null]) {
      await expect(uploadService.deleteLocalUpload(value)).resolves.toBe(false);
    }
    expect(fs.unlink).not.toHaveBeenCalled();
  });

  it('deletes a genuine local upload', async () => {
    await expect(
      uploadService.deleteLocalUpload('/uploads/products/0123456789abcdef0123456789abcdef.png')
    ).resolves.toBe(true);
    expect(fs.unlink).toHaveBeenCalledTimes(1);
  });

  it('treats an already-missing file as nothing to do', async () => {
    fs.unlink.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'ENOENT' }));

    await expect(
      uploadService.deleteLocalUpload('/uploads/products/0123456789abcdef0123456789abcdef.png')
    ).resolves.toBe(false);
  });
});

'use strict';

const jwt = require('jsonwebtoken');

const {
  generateAccessToken,
  verifyAccessToken,
  extractBearerToken,
  VERIFY_OPTIONS,
} = require('../src/utils/jwt');
const env = require('../src/config/env');
const { AuthenticationError } = require('../src/utils/errors');
const { ERROR_CODES } = require('../src/constants');

describe('utils/jwt', () => {
  describe('generateAccessToken', () => {
    it('signs a token carrying the subject and custom claims', () => {
      const token = generateAccessToken({ sub: 42, role: 'cinema_admin' });
      const decoded = jwt.verify(token, env.jwt.secret, VERIFY_OPTIONS);

      expect(decoded.sub).toBe('42');
      expect(decoded.role).toBe('cinema_admin');
      expect(decoded.iss).toBe(env.jwt.issuer);
      expect(decoded.exp).toBeGreaterThan(decoded.iat);
    });

    it('rejects a payload without a subject', () => {
      expect(() => generateAccessToken({ role: 'owner' })).toThrow(TypeError);
      expect(() => generateAccessToken(null)).toThrow(TypeError);
    });
  });

  describe('verifyAccessToken', () => {
    it('round-trips a freshly generated token', () => {
      const token = generateAccessToken({ sub: 7 });
      expect(verifyAccessToken(token).sub).toBe('7');
    });

    it('rejects a missing token', () => {
      expect(() => verifyAccessToken()).toThrow(AuthenticationError);
      expect(() => verifyAccessToken('')).toThrow(AuthenticationError);
    });

    it('rejects a malformed token', () => {
      expect(() => verifyAccessToken('not-a-jwt')).toThrow(AuthenticationError);
    });

    it('rejects a token signed with a different secret', () => {
      const forged = jwt.sign({ sub: '1' }, 'some-other-secret-value', {
        issuer: env.jwt.issuer,
      });
      expect(() => verifyAccessToken(forged)).toThrow('Invalid authentication token');
    });

    it('rejects a token from an unexpected issuer', () => {
      const wrongIssuer = jwt.sign({ sub: '1' }, env.jwt.secret, { issuer: 'somebody-else' });
      expect(() => verifyAccessToken(wrongIssuer)).toThrow('Invalid authentication token');
    });

    it('reports an expired token with the TOKEN_EXPIRED code', () => {
      const expired = generateAccessToken({ sub: 1 }, { expiresIn: '-1s' });

      expect.assertions(3);
      try {
        verifyAccessToken(expired);
      } catch (err) {
        expect(err).toBeInstanceOf(AuthenticationError);
        expect(err.code).toBe(ERROR_CODES.TOKEN_EXPIRED);
        expect(err.statusCode).toBe(401);
      }
    });
  });

  describe('extractBearerToken', () => {
    it('extracts the token from a well-formed header', () => {
      expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    });

    it('is case-insensitive on the scheme', () => {
      expect(extractBearerToken('bearer abc')).toBe('abc');
      expect(extractBearerToken('BEARER abc')).toBe('abc');
    });

    it.each([
      ['undefined header', undefined],
      ['empty string', ''],
      ['no scheme', 'abc.def.ghi'],
      ['wrong scheme', 'Basic abc'],
      ['missing token', 'Bearer'],
      ['extra segments', 'Bearer abc def'],
    ])('returns null for %s', (_label, header) => {
      expect(extractBearerToken(header)).toBeNull();
    });
  });
});

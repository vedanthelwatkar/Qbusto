'use strict';

/**
 * The Jalpi transport.
 *
 * Two things are actually worth pinning here, and this file exists for them:
 *
 *   1. THE REQUEST CONTRACT. The client supplied one working call and one
 *      approved template. A field renamed by accident (`TemplateName` is
 *      capitalised, `BodyParameter` is singular) fails silently at the
 *      provider, not here.
 *
 *   2. THE RESPONSE POLICY. Jalpi answers **200 OK even when it refuses the
 *      message** - observed live as
 *      `{"ErrorCode":"506","ErrorMessage":"your waba configuration not
 *      found"}`. So HTTP status alone proves nothing and `ErrorCode` is the
 *      real signal: `000` is success, anything else populated is a refusal.
 *      Both halves are now observed live. The success body echoes the API key
 *      and the customer's number back, which is why what leaves this boundary
 *      is asserted as tightly as what enters it.
 *
 * And, running through both: the API key travels in the request BODY, so
 * every assertion about what is logged or thrown matters more than it would
 * for a header-authenticated provider.
 */

// Set before the first require of src/config/env, which validates at load.
const FAKE_KEY = 'sanitized-test-key-should-never-leak';
process.env.JALPI_API_KEY = FAKE_KEY;
process.env.JALPI_BASE_URL = 'https://jalpi.test';

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const logger = require('../src/config/logger');
const whatsapp = require('../src/services/whatsapp.client');

const TO = '919876543210';
const PARAMS = ['#: 4242 | Screen #: 1 | Seat #: A5', 'Noida'];

/** Make fetch answer once with this status and body. */
function respondWith(status, body) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

/** Everything this module wrote to a log, flattened to one searchable string. */
function everythingLogged() {
  return [logger.info, logger.warn, logger.error, logger.debug]
    .flatMap((fn) => fn.mock.calls)
    .map((call) => JSON.stringify(call))
    .join(' ');
}

const send = () => whatsapp.sendOrderConfirmation({ to: TO, bodyParameters: PARAMS });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the request Jalpi actually receives', () => {
  it('posts the client-supplied contract, field for field', async () => {
    respondWith(200, { status: true });

    await send();

    const [url, init] = global.fetch.mock.calls[0];

    expect(url).toBe('https://jalpi.test/api/v1/sendTemplateMessage');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');

    // Capitalisation is the provider's, not ours. Do not "tidy" these.
    expect(JSON.parse(init.body)).toEqual({
      key: FAKE_KEY,
      to: TO,
      languageCode: 'en',
      TemplateName: 'sos_order',
      BodyParameter: [
        { type: 'text', text: PARAMS[0] },
        { type: 'text', text: PARAMS[1] },
      ],
    });
  });

  it('sends no image header, because the approved template has none', async () => {
    respondWith(200, {});

    await send();

    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);

    // Jalpi allows these four; sos_order does not use them, and QBusto has no
    // public image URL to invent one from.
    expect(payload).not.toHaveProperty('headertype');
    expect(payload).not.toHaveProperty('link');
    expect(payload).not.toHaveProperty('filename');
    expect(payload).not.toHaveProperty('headertext');
  });

  it('authenticates with the body key and no Authorization header', async () => {
    respondWith(200, {});

    await send();

    // The C# example and the client's own call both authenticate this way.
    // A username/password was never sent to this endpoint.
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});

describe('when it is not configured', () => {
  it('refuses to send rather than calling the provider unauthenticated', async () => {
    const realKey = require('../src/config/env').whatsapp.apiKey;
    require('../src/config/env').whatsapp.apiKey = '';

    try {
      expect(whatsapp.isConfigured()).toBe(false);
      await expect(send()).rejects.toThrow('not configured');
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      require('../src/config/env').whatsapp.apiKey = realKey;
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * The response policy - both halves OBSERVED live against the client's key.
 * ---------------------------------------------------------------------------
 */
describe('interpreting a response', () => {
  it('treats a non-2xx as a failure', async () => {
    respondWith(401, { error: 'unauthorized' });

    await expect(send()).rejects.toThrow('HTTP 401');
  });

  it('treats a transport failure as a failure, keeping the cause', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(send()).rejects.toThrow('WhatsApp request failed');
  });

  it.each([
    ['status false', { status: false }],
    ['status "false"', { status: 'false' }],
    ['status "error"', { status: 'error' }],
    ['a populated error string', { error: 'invalid template' }],
    ['a populated error object', { error: { code: 'E42' } }],
    // OBSERVED LIVE against the client's key: Jalpi refuses inside a 200.
    [
      'Jalpi ErrorCode 506',
      { ErrorCode: '506', ErrorMessage: 'your waba configuration not found' },
    ],
  ])('treats an explicit failure signal (%s) as a failure', async (_label, body) => {
    respondWith(200, body);

    await expect(send()).rejects.toThrow('rejected the message');
  });

  it.each([
    ['an empty object', {}],
    ['an unrecognised shape', { foo: 'bar' }],
    ['an empty error field', { error: '' }],
    // "0"/"000" is the conventional no-error value in this style of API.
    ['a zero ErrorCode', { ErrorCode: '000', ErrorMessage: 'success' }],
    ['plain text', 'Message queued'],
    ['an empty body', ''],
  ])('provisionally accepts a 2xx with no failure signal (%s)', async (_label, body) => {
    respondWith(200, body);

    /*
     * The deliberate half of the policy. Marking a genuinely sent message
     * `failed` because it lacked a field we happened to look for is the worse
     * error - it would make orders.whatsapp_status useless as a signal.
     *
     * This is NOT proof of delivery. "Sent" means Jalpi accepted the request.
     */
    await expect(send()).resolves.toEqual(expect.objectContaining({ messageId: null }));
  });

  /** The real success body, observed live. */
  const SUCCESS_BODY = {
    ErrorCode: '000',
    ErrorMessage: 'success',
    Data: [
      {
        Key: FAKE_KEY,
        InstanceNumber: '919217497755',
        mobileNumber: TO,
        MaskId: '4527a520fbf94995b0f59580d5ec3bd0',
      },
    ],
  };

  it('accepts ErrorCode 000 and keeps the MaskId as the trace id', async () => {
    respondWith(200, SUCCESS_BODY);

    await expect(send()).resolves.toEqual({ messageId: '4527a520fbf94995b0f59580d5ec3bd0' });
  });

  /*
   * THE MOST IMPORTANT ASSERTION IN THIS FILE.
   *
   * Jalpi's SUCCESS body echoes the API key and the customer's number back.
   * Only MaskId is picked out; everything else is discarded at this boundary,
   * so a future caller that logs whatever it is handed still cannot leak them.
   */
  it('returns nothing from a success body except the trace id', async () => {
    respondWith(200, SUCCESS_BODY);

    const result = await send();

    expect(Object.keys(result)).toEqual(['messageId']);
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(result)).not.toContain(TO);
  });
});

describe('what reaches the logs', () => {
  it('never logs the API key, on any path', async () => {
    respondWith(500, { key: FAKE_KEY, error: 'boom' });
    await send().catch(() => {});

    respondWith(200, { status: false, code: 'E42' });
    await send().catch(() => {});

    respondWith(200, { status: true });
    await send();

    expect(everythingLogged()).not.toContain(FAKE_KEY);
  });

  it('never logs the customer number or the provider body', async () => {
    // A provider error body echoing the request back is exactly the case.
    respondWith(200, { status: false, code: 'E42', message: `no WhatsApp account for ${TO}` });

    await send().catch(() => {});

    const logged = everythingLogged();

    expect(logged).not.toContain(TO);
    expect(logged).not.toContain('no WhatsApp account');
    // A short scalar code IS useful and carries nothing.
    expect(logged).toContain('E42');
  });

  it('logs the Jalpi error code but never its free-text message', async () => {
    respondWith(200, { ErrorCode: '506', ErrorMessage: `no waba for ${TO}` });

    await expect(send()).rejects.toThrow('code 506');

    const logged = everythingLogged();
    expect(logged).toContain('506');
    expect(logged).not.toContain('no waba for');
    expect(logged).not.toContain(TO);
  });

  it('keeps the customer number out of the thrown error too', async () => {
    respondWith(200, { status: false, message: `no WhatsApp account for ${TO}` });

    await expect(send()).rejects.toThrow(/^(?!.*\d{12}).*$/);
  });
});

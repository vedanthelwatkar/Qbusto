'use strict';

/**
 * The WhatsApp order confirmation, and the one invariant it must never break.
 *
 * A confirmation is a POST-ORDER SIDE EFFECT. The customer has already paid;
 * the food is already the kitchen's work. So every failure mode of the
 * notification path - no sender configured, a malformed number, a 500 from
 * Jalpi, a timeout, an outright programming error - has to end as a log line
 * and a `whatsapp_status`, never as a thrown error reaching the payment
 * transition that queued it.
 *
 * These tests drive notification.service directly and assert that: nothing it
 * can be handed makes it reject.
 */

jest.mock('../src/config/database', () => ({
  models: {
    Order: { findByPk: jest.fn(), update: jest.fn() },
  },
  sequelize: {},
}));

jest.mock('../src/services/whatsapp.client', () => ({
  isConfigured: jest.fn(),
  toWhatsAppNumber: jest.fn(),
  sendOrderConfirmation: jest.fn(),
}));

const { models } = require('../src/config/database');
const whatsapp = require('../src/services/whatsapp.client');
const notifications = require('../src/services/notification.service');

const ORDER_ID = 4242;

function buildOrder(overrides = {}) {
  const { cinema = {}, ...rest } = overrides;

  return {
    id: ORDER_ID,
    cinemaId: 8,
    customerMobile: '9876543210',
    seatNumber: 'A5',
    screen: { name: 'Screen 1' },
    cinema: {
      name: '1Cinemas Noida',
      city: 'Noida',
      whatsappEnabled: true,
      ...cinema,
    },
    ...rest,
  };
}

/** The status written to orders.whatsapp_status, or null if none was. */
function writtenStatus() {
  const call = models.Order.update.mock.calls[0];
  return call ? call[0].whatsappStatus : null;
}

beforeEach(() => {
  jest.clearAllMocks();
  models.Order.update.mockResolvedValue([1]);
  whatsapp.isConfigured.mockReturnValue(true);
  whatsapp.toWhatsAppNumber.mockImplementation((mobile) => (mobile ? `91${mobile}` : null));
  whatsapp.sendOrderConfirmation.mockResolvedValue({ messageId: 'wamid.TEST' });
});

describe('notification.service - the happy path', () => {
  it('sends the confirmation and records success', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());

    await notifications.notifyOrderConfirmed(ORDER_ID);

    expect(whatsapp.sendOrderConfirmation).toHaveBeenCalledWith({
      to: '919876543210',
      /*
       * The client's approved `sos_order` template, in template order:
       *   {{1}} "#: <id> | Screen #: <screen> | Seat #: <seat>"
       *   {{2}} cinema location
       *
       * TWO entries, always. Jalpi rejects a parameter count that does not
       * match the approved body, so this assertion is the guard against
       * someone reintroducing the old five-value mapping.
       */
      bodyParameters: [`#: ${ORDER_ID} | Screen #: 1 | Seat #: A5`, 'Noida'],
    });
    expect(writtenStatus()).toBe('success');
  });
});

describe('notification.service - template parameters', () => {
  /** The one assertion that a template re-approval must not silently break. */
  it('sends exactly two parameters, never the old five', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());

    await notifications.notifyOrderConfirmed(ORDER_ID);

    expect(whatsapp.sendOrderConfirmation.mock.calls[0][0].bodyParameters).toHaveLength(2);
  });

  /*
   * A provider rejects an empty parameter value outright, so a counter order
   * with no auditorium and no seat must still produce two printable values.
   */
  it('falls back to a placeholder for a missing screen and seat', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ screen: null, seatNumber: null }));

    await notifications.notifyOrderConfirmed(ORDER_ID);

    const { bodyParameters } = whatsapp.sendOrderConfirmation.mock.calls[0][0];

    expect(bodyParameters).toEqual([`#: ${ORDER_ID} | Screen #: - | Seat #: -`, 'Noida']);
    expect(bodyParameters.every((value) => value !== '')).toBe(true);
  });

  /*
   * The parameter already reads "Screen #: X", so "Screen 1" would render as
   * "Screen #: Screen 1". Only that exact shape is trimmed.
   */
  it('leaves an auditorium name that is not just "Screen <n>" alone', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ screen: { name: 'IMAX' } }));

    await notifications.notifyOrderConfirmed(ORDER_ID);

    expect(whatsapp.sendOrderConfirmation.mock.calls[0][0].bodyParameters[0]).toContain(
      'Screen #: IMAX'
    );
  });

  /*
   * An input the Consumer cannot produce but the backend accepts: optionalText
   * trims the ends only. WhatsApp refuses a parameter containing a newline, so
   * the order would be paid for and the confirmation refused.
   */
  it('flattens a seat number containing a newline', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ seatNumber: 'A\n5' }));

    await notifications.notifyOrderConfirmed(ORDER_ID);

    const [first] = whatsapp.sendOrderConfirmation.mock.calls[0][0].bodyParameters;

    expect(first).toBe(`#: ${ORDER_ID} | Screen #: 1 | Seat #: A 5`);
    expect(first).not.toMatch(/[\n\r\t]/);
  });

  /*
   * {{2}} comes from QBusto's own cinema row - never from a hard-coded
   * cinema-code mapping like the client's legacy stored procedure used.
   */
  it('takes the location from the cinema, falling back to its name', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ cinema: { city: null } }));

    await notifications.notifyOrderConfirmed(ORDER_ID);

    expect(whatsapp.sendOrderConfirmation.mock.calls[0][0].bodyParameters[1]).toBe(
      '1Cinemas Noida'
    );
  });
});

describe('notification.service - a failure never invalidates the order', () => {
  /**
   * The central assertion of this file. Each case is a different way the
   * provider path can go wrong; none of them may reject.
   */
  const cases = [
    [
      'the provider returns an error',
      () => whatsapp.sendOrderConfirmation.mockRejectedValue(new Error('WhatsApp returned HTTP 500')),
    ],
    [
      'the provider times out',
      () =>
        whatsapp.sendOrderConfirmation.mockRejectedValue(
          new Error('WhatsApp sendOrderConfirmation timed out after 8000ms')
        ),
    ],
    [
      'the deployment has no sender configured',
      () => whatsapp.isConfigured.mockReturnValue(false),
    ],
    [
      'reading the order itself fails',
      () => models.Order.findByPk.mockRejectedValue(new Error('connection reset')),
    ],
    [
      'the client throws something that is not an Error',
      () => whatsapp.sendOrderConfirmation.mockImplementation(() => Promise.reject(new TypeError('x'))),
    ],
  ];

  test.each(cases)('resolves rather than throwing when %s', async (_label, arrange) => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    arrange();

    await expect(notifications.notifyOrderConfirmed(ORDER_ID)).resolves.toBeUndefined();
  });

  it('records failed so the outcome is visible on the order', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    whatsapp.sendOrderConfirmation.mockRejectedValue(new Error('WhatsApp returned HTTP 500'));

    await notifications.notifyOrderConfirmed(ORDER_ID);

    expect(writtenStatus()).toBe('failed');
  });

  it('does not throw even when recording the failure ALSO fails', async () => {
    // The bookkeeping of a notification is even less of a reason to disturb
    // an order than the notification itself.
    models.Order.findByPk.mockResolvedValue(buildOrder());
    whatsapp.sendOrderConfirmation.mockRejectedValue(new Error('boom'));
    models.Order.update.mockRejectedValue(new Error('database is down'));

    await expect(notifications.notifyOrderConfirmed(ORDER_ID)).resolves.toBeUndefined();
  });
});

describe('notification.service - when nothing should be sent', () => {
  it('sends nothing when the cinema has the channel switched off', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ cinema: { whatsappEnabled: false } }));

    await notifications.notifyOrderConfirmed(ORDER_ID);

    expect(whatsapp.sendOrderConfirmation).not.toHaveBeenCalled();
    // Never attempted is not a failure: the column stays NULL.
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  it('sends nothing when the order carries no usable mobile number', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder({ customerMobile: null }));
    whatsapp.toWhatsAppNumber.mockReturnValue(null);

    await notifications.notifyOrderConfirmed(ORDER_ID);

    expect(whatsapp.sendOrderConfirmation).not.toHaveBeenCalled();
    expect(models.Order.update).not.toHaveBeenCalled();
  });

  it('sends nothing, and does not throw, for an order that does not exist', async () => {
    models.Order.findByPk.mockResolvedValue(null);

    await expect(notifications.notifyOrderConfirmed(ORDER_ID)).resolves.toBeUndefined();
    expect(whatsapp.sendOrderConfirmation).not.toHaveBeenCalled();
  });
});

describe('notification.service - queueing', () => {
  it('waits for the transaction to commit before sending anything', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());

    let committed;
    const transaction = {
      afterCommit: jest.fn((callback) => {
        committed = callback;
      }),
    };

    notifications.queueOrderConfirmed(transaction, ORDER_ID);

    // Nothing has happened yet - the order is not committed.
    expect(whatsapp.sendOrderConfirmation).not.toHaveBeenCalled();
    expect(transaction.afterCommit).toHaveBeenCalledTimes(1);

    committed();
    await new Promise((resolve) => setImmediate(resolve));

    expect(whatsapp.sendOrderConfirmation).toHaveBeenCalledTimes(1);
  });

  it('never sends when the transaction rolls back', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());

    // A rolled-back transaction never invokes its afterCommit callbacks.
    const transaction = { afterCommit: jest.fn() };

    notifications.queueOrderConfirmed(transaction, ORDER_ID);
    await new Promise((resolve) => setImmediate(resolve));

    expect(whatsapp.sendOrderConfirmation).not.toHaveBeenCalled();
  });

  it('queueing does not throw when the provider will fail', async () => {
    models.Order.findByPk.mockResolvedValue(buildOrder());
    whatsapp.sendOrderConfirmation.mockRejectedValue(new Error('boom'));

    let committed;
    const transaction = {
      afterCommit: jest.fn((callback) => {
        committed = callback;
      }),
    };

    notifications.queueOrderConfirmed(transaction, ORDER_ID);

    // The commit hook itself must not surface the provider's rejection.
    expect(() => committed()).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });
});

// ---------------------------------------------------------------------------
// The transport's own number handling, tested against the real module
// ---------------------------------------------------------------------------

describe('whatsapp.client.toWhatsAppNumber', () => {
  const { toWhatsAppNumber } = jest.requireActual('../src/services/whatsapp.client');

  it('prefixes the country code onto a bare ten-digit number', () => {
    expect(toWhatsAppNumber('9876543210')).toBe('919876543210');
  });

  it('leaves a number that already carries a country code alone', () => {
    expect(toWhatsAppNumber('+91 98765 43210')).toBe('919876543210');
  });

  it('rejects anything too short to be a phone number', () => {
    expect(toWhatsAppNumber('12345')).toBeNull();
  });

  it('rejects null and non-strings rather than sending to a malformed address', () => {
    expect(toWhatsAppNumber(null)).toBeNull();
    expect(toWhatsAppNumber(undefined)).toBeNull();
    expect(toWhatsAppNumber(9876543210)).toBeNull();
  });
});

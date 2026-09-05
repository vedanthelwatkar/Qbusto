'use strict';

/**
 * OpenAPI definition, shared by two consumers:
 *   - src/app.js serves it at /api/docs via swagger-ui-express
 *   - scripts/generate-openapi.js writes it to shared/openapi.json for the
 *     frontend orval clients
 *
 * Keeping one definition means the served docs and the generated client can
 * never drift apart.
 *
 * Route documentation itself lives in @openapi JSDoc blocks in src/routes.
 */

const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');

const env = require('./env');
const pkg = require('../../package.json');

/**
 * The 42 per-day discount properties on ProductPricing - type, value and four
 * channel overrides, for each of the seven days. Generated rather than typed
 * out, for the same reason the migration and the model generate them: it is
 * mechanical repetition of one shape, seven times, not a new concept per day.
 */
function dayDiscountProperties() {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const channels = ['Qr', 'Kiosk', 'SeatQr', 'Counter'];
  const properties = {};

  for (const day of days) {
    const cap = day.charAt(0).toUpperCase() + day.slice(1);

    properties[`${day}DiscountType`] = {
      type: 'string',
      enum: ['P', 'F'],
      nullable: true,
      description: `P = percentage, F = flat amount. Governs every ${day}DiscountOn* value - ${cap}'s discount only, independently of every other day.`,
    };
    properties[`${day}DiscountValue`] = { type: 'number', format: 'double', nullable: true };

    for (const channel of channels) {
      properties[`${day}DiscountOn${channel}`] = {
        type: 'number',
        format: 'double',
        nullable: true,
      };
    }
  }

  return properties;
}

/**
 * Absolute, so the spec builds identically no matter the working directory
 * (npm scripts run from backend/, but the CLI may not). Separators are
 * normalised to forward slashes because glob does not match backslashes on
 * Windows.
 */
const apis = [path.join(__dirname, '..', 'routes', '**', '*.js').split(path.sep).join('/')];

const definition = {
  openapi: '3.0.0',
  info: {
    title: 'Cinema Ordering API',
    version: pkg.version,
    description:
      'QBusto backend API. Operational probes (/health, /ready, /version) live ' +
      'at the root; all business endpoints live under /api.',
  },
  servers: [{ url: env.apiBaseUrl, description: env.nodeEnv }],
  tags: [
    { name: 'Health', description: 'Liveness, readiness and version probes' },
    { name: 'Meta', description: 'API metadata' },
    { name: 'Auth', description: 'Login, session and password management' },
    { name: 'Users', description: 'User accounts and module permissions' },
    { name: 'Chains', description: 'Cinema chains - the top of the tenant tree' },
    { name: 'Cinemas', description: 'Cinemas belonging to a chain' },
    { name: 'Screens', description: 'Screens belonging to a cinema' },
    { name: 'Categories', description: 'Chain-scoped product categories' },
    { name: 'Products', description: 'Chain-scoped products and add-ons' },
    {
      name: 'Cinema Products',
      description: 'Which products a cinema carries - the parent of availability hours',
    },
    {
      name: 'Product Availability Hours',
      description: 'When a product is orderable at a cinema',
    },
    { name: 'Product Pricing', description: 'Per-cinema, per-day product prices and discounts' },
    { name: 'Banners', description: 'Promotional images shown for a cinema' },
    { name: 'Orders', description: 'Customer orders, their items and their lifecycle' },
    {
      name: 'Order Statuses',
      description: 'The seeded order and payment lifecycle master tables',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token issued by the authentication endpoint.',
      },
    },
    schemas: {
      ResponseMeta: {
        type: 'object',
        properties: {
          timestamp: { type: 'string', format: 'date-time' },
          requestId: { type: 'string', format: 'uuid' },
          // Present on list endpoints only - paginated() in src/utils/response.js
          // merges it into meta, and success() does not.
          pagination: { $ref: '#/components/schemas/Pagination' },
        },
      },
      Pagination: {
        type: 'object',
        description: 'Present in `meta` on paginated list responses.',
        properties: {
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 20 },
          // Total matching rows, ignoring pagination.
          total: { type: 'integer', example: 137 },
          totalPages: { type: 'integer', example: 7 },
          hasNextPage: { type: 'boolean', example: true },
          hasPreviousPage: { type: 'boolean', example: false },
        },
      },
      SuccessResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'OK' },
          data: {},
          meta: { $ref: '#/components/schemas/ResponseMeta' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string', example: 'Request validation failed' },
              details: {},
            },
          },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
        },
      },
      UserPermission: {
        type: 'object',
        properties: {
          moduleName: {
            type: 'string',
            enum: [
              'Dashboard',
              'Orders',
              'Products',
              'Categories',
              'Pricing',
              'Banners',
              'Users',
              'Reports',
              'POS Integrations',
              'Settings',
              'Offers',
            ],
            example: 'Orders',
          },
          canRead: { type: 'boolean', example: true },
          canEdit: { type: 'boolean', example: false },
          canDelete: { type: 'boolean', example: false },
        },
      },
      UserPermissionInput: {
        allOf: [
          { $ref: '#/components/schemas/UserPermission' },
          { type: 'object', required: ['moduleName'] },
        ],
        description: 'Omitted flags default to false.',
      },
      // The password hash is not part of this schema and is never returned.
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 12 },
          chainId: { type: 'integer', example: 1 },
          cinemaId: { type: 'integer', nullable: true, example: 3 },
          role: {
            type: 'string',
            enum: ['owner', 'chain_admin', 'cinema_admin', 'kitchen_staff', 'cinema_accountant'],
            example: 'cinema_admin',
          },
          username: { type: 'string', example: 'jordan.p' },
          firstName: { type: 'string', nullable: true, example: 'Jordan' },
          lastName: { type: 'string', nullable: true, example: 'Pereira' },
          mobile: { type: 'string', nullable: true, example: '9876543210' },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          permissions: {
            type: 'array',
            description: 'Present only when the user was loaded with permissions.',
            items: { $ref: '#/components/schemas/UserPermission' },
          },
        },
      },
      Chain: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          name: { type: 'string', example: 'Starlight Cinemas' },
          logoImageUrl: {
            type: 'string',
            nullable: true,
            example: 'https://cdn.qbusto.com/chains/1/logo.png',
          },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Cinema: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 3 },
          chainId: { type: 'integer', example: 1 },
          code: {
            type: 'string',
            description: 'Short identifier used in QR ordering URLs. Unique system-wide.',
            example: 'BLR-01',
          },
          name: { type: 'string', example: 'Starlight Indiranagar' },
          location: { type: 'string', nullable: true, example: '100 Feet Road, Indiranagar' },
          city: { type: 'string', nullable: true, example: 'Bengaluru' },
          gstNumber: { type: 'string', nullable: true, example: '29ABCDE1234F1Z5' },
          fssaiNumber: { type: 'string', nullable: true, example: '12345678901234' },
          screensaverUrl: {
            type: 'string',
            nullable: true,
            maxLength: 500,
            example: '/uploads/cinemas/9f2c4e18a7b34d5069e1c8f0b2a67d3e.webp',
            description:
              'Consumer screensaver artwork. An upload path or an external URL, in one field. ' +
              'Null for cinemas created before the field existed - the Consumer falls back to its text hero.',
          },
          activeSince: { type: 'string', format: 'date-time', nullable: true },
          smsEnabled: { type: 'boolean', example: false },
          whatsappEnabled: { type: 'boolean', example: false },
          offersEnabled: {
            type: 'boolean',
            example: true,
            description:
              'Whether this cinema accepts coupon codes. Off hides the Consumer coupon ' +
              'section AND is enforced server-side in coupon.service - a crafted request ' +
              'cannot apply a coupon while this is false. Existing offers are untouched.',
          },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          content: {
            description:
              'The About Cinema / Terms & Conditions footer content. Only present on ' +
              'GET /api/consumer/cinemas/{id} - the staff endpoints manage it separately ' +
              'via GET/PUT /api/cinemas/{id}/content.',
            allOf: [{ $ref: '#/components/schemas/CinemaContent' }],
          },
        },
      },
      CinemaContent: {
        type: 'object',
        description:
          "A cinema's About Cinema / Terms & Conditions footer content. One row per " +
          'cinema; an unconfigured cinema returns nulls and an empty tncPoints rather ' +
          'than a 404.',
        properties: {
          cinemaId: { type: 'integer', nullable: true, example: 8 },
          contactNo: { type: 'string', nullable: true, maxLength: 20, example: '9999999999' },
          mailId: {
            type: 'string',
            nullable: true,
            format: 'email',
            example: 'contactus@1cinema.co',
          },
          tncPoints: {
            type: 'array',
            items: { type: 'string', maxLength: 500 },
            example: [
              'All food items are prepared in a hygienic environment and FSSAI approved kitchen.',
              'Menu items, prices and offers are subject to change without prior notice.',
            ],
          },
          iconUrl: {
            type: 'string',
            nullable: true,
            description: 'Optional custom icon for the About Cinema section, uploaded by staff.',
            example: '/uploads/cinemas/icon-12345.jpg',
          },
        },
      },
      Screen: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 8 },
          cinemaId: { type: 'integer', example: 3 },
          name: {
            type: 'string',
            description: 'Unique within its cinema.',
            example: 'Screen 1',
          },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Category: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 4 },
          chainId: { type: 'integer', example: 1 },
          name: { type: 'string', example: 'Beverages' },
          description: { type: 'string', nullable: true, example: 'Hot and cold drinks' },
          imageUrl: { type: 'string', nullable: true },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          cinemaIds: {
            type: 'array',
            items: { type: 'integer' },
            description:
              'Ids of the cinemas this category is assigned to, active links only. Returned by ' +
              'the single-category read, not by the list.',
            example: [8, 9],
          },
        },
      },
      Product: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 17 },
          chainId: {
            type: 'integer',
            example: 1,
            description: "Copied from the product's category; never accepted from a request.",
          },
          categoryId: { type: 'integer', example: 4 },
          name: { type: 'string', example: 'Salted Popcorn' },
          description: { type: 'string', nullable: true },
          weight: { type: 'string', nullable: true, example: '150g' },
          imageUrl: { type: 'string', nullable: true },
          taxSlabCode: { type: 'string', nullable: true, example: 'GST5' },
          isAddon: { type: 'boolean', example: false },
          addonParentId: { type: 'integer', nullable: true, example: null },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          isAllTimeFavourite: {
            type: 'boolean',
            example: false,
            description:
              'Consumer catalogue only: whether this product is in the fixed "All Time ' +
              'Favourite" section at the cinema being browsed. Absent from the staff list.',
          },
          cinemaProduct: {
            type: 'object',
            nullable: true,
            description:
              'This product at ONE cinema. Returned by the list only when it was called with ' +
              '`cinemaId`, and null when that cinema does not carry the product.',
            properties: {
              id: { type: 'integer', example: 12 },
              isActive: { type: 'boolean', example: true },
              isAllTimeFavourite: { type: 'boolean', example: false },
            },
          },
          cinemaIds: {
            type: 'array',
            items: { type: 'integer' },
            description:
              'Ids of the cinemas that carry this product, active links only. Returned by the ' +
              'single-product read, not by the list.',
            example: [8, 9],
          },
        },
      },
      CinemaProduct: {
        type: 'object',
        description:
          'The link saying a cinema carries a product. Availability windows hang off its id.',
        properties: {
          id: { type: 'integer', example: 12 },
          cinemaId: { type: 'integer', example: 3 },
          productId: { type: 'integer', example: 17 },
          sequence: {
            type: 'integer',
            example: 0,
            description: 'Display order within the cinema. Not unique.',
          },
          availableFrom: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Start of a date-range offer. Null means no lower bound.',
          },
          availableUntil: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'End of a date-range offer. Null means no upper bound.',
          },
          isActive: { type: 'boolean', example: true },
          isAllTimeFavourite: {
            type: 'boolean',
            example: false,
            description:
              'Membership of the fixed "All Time Favourite" section of the Consumer catalogue, ' +
              'for this cinema only. The product keeps its own category as well.',
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ProductAvailabilityHour: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 31 },
          cinemaProductId: {
            type: 'integer',
            example: 12,
            description: 'The cinema/product link this window applies to.',
          },
          dayOfWeek: {
            type: 'integer',
            minimum: 0,
            maximum: 7,
            example: 0,
            description: '0 = every day, 1 = Monday ... 7 = Sunday.',
          },
          startTime: { type: 'string', example: '09:00:00' },
          endTime: { type: 'string', example: '17:30:00' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ProductPricing: {
        type: 'object',
        description:
          'Monetary columns are DECIMAL(10,2) in the database and arrive as JSON ' +
          'numbers: the SQL Server driver hands Sequelize a JS number and the ' +
          'service passes it through, so 250.00 is serialised as 250. Format for ' +
          'display rather than assuming two decimal places on the wire. ' +
          'Each day has its own discount, independently of every other day - a ' +
          "Wednesday discount never applies on Thursday. A day's discount amount " +
          "is only meaningful when that SAME day's discount type is set. " +
          'ONE ROW HOLDS THE WHOLE WEEK: each day has its own price, and a ' +
          'null day price means the product is not sold that day (it does NOT ' +
          'mean free). Which day applies (for both price and discount) is the ' +
          'QBusto business day, 06:00 to 06:00 - an order at 01:00 on Monday ' +
          'pays, and is discounted as, Sunday.',
        properties: {
          id: { type: 'integer', example: 22 },
          cinemaId: { type: 'integer', example: 3 },
          productId: { type: 'integer', example: 17 },
          mondayPrice: { type: 'number', format: 'double', nullable: true, example: 250 },
          tuesdayPrice: { type: 'number', format: 'double', nullable: true, example: 250 },
          wednesdayPrice: { type: 'number', format: 'double', nullable: true, example: 250 },
          thursdayPrice: { type: 'number', format: 'double', nullable: true, example: 250 },
          fridayPrice: { type: 'number', format: 'double', nullable: true, example: 250 },
          saturdayPrice: { type: 'number', format: 'double', nullable: true, example: 250 },
          sundayPrice: { type: 'number', format: 'double', nullable: true, example: 250 },
          ...dayDiscountProperties(),
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Banner: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 9 },
          cinemaId: { type: 'integer', example: 3 },
          imageUrl: { type: 'string', example: 'https://cdn.qbusto.com/banners/9.png' },
          type: {
            type: 'string',
            enum: ['H', 'I'],
            example: 'H',
            description: 'H = header, I = inner.',
          },
          sequence: {
            type: 'integer',
            example: 1,
            description: 'Display order. Unique within a cinema.',
          },
          startDate: { type: 'string', format: 'date-time', nullable: true },
          endDate: { type: 'string', format: 'date-time', nullable: true },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Offer: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 4 },
          cinemaId: { type: 'integer', example: 3 },
          code: { type: 'string', example: 'abcd15' },
          name: { type: 'string', example: 'Weekend UPI Offer' },
          discountType: {
            type: 'string',
            example: 'flat',
            description:
              '"percentage" (case-insensitive) drives percent-of-cart math; anything else, including "flat", is a flat rupee amount.',
          },
          description: { type: 'string', nullable: true },
          tnc: { type: 'string', nullable: true },
          status: { type: 'string', example: 'active' },
          discAmount: { type: 'number', format: 'decimal', example: 200 },
          maxDiscAmount: {
            type: 'number',
            format: 'decimal',
            nullable: true,
            description:
              'Only meaningful when discountType is "percentage" - caps the discount a percentage coupon can give. Ignored for a flat coupon, which is already a fixed amount.',
          },
          minTxnAmount: { type: 'number', format: 'decimal', nullable: true },
          maxTxnAmount: { type: 'number', format: 'decimal', nullable: true },
          maxTxnLimit: {
            type: 'integer',
            nullable: true,
            description: 'Redemption count cap, not an amount.',
          },
          validFrom: { type: 'string', format: 'date-time', nullable: true },
          validUntil: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      PaymentGatewayConfig: {
        type: 'object',
        description: 'Never carries the secret key itself - see hasSecret.',
        properties: {
          id: { type: 'integer', example: 2 },
          cinemaId: { type: 'integer', example: 3 },
          gatewayId: { type: 'string', example: 'TEST11196503d1188251c10567fb73c030569111' },
          environment: {
            type: 'string',
            enum: ['test', 'sandbox', 'prod', 'production'],
            example: 'test',
          },
          isActive: { type: 'boolean', example: true },
          hasSecret: {
            type: 'boolean',
            example: true,
            description: 'Whether a secret key is on file. Never the key itself.',
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Session: {
        type: 'object',
        description:
          'One screening. The single source of show data in QBusto: the film ' +
          'title is a column on this row, not a join. Read-only - the schedule is ' +
          'synchronized from the POS. The auditorium is named rather than ' +
          'referenced by id.',
        properties: {
          cinemaCode: { type: 'string', example: 'NOIDA' },
          sessionId: {
            type: 'integer',
            example: 18757,
            description: "The source system's session id, unique within a cinema.",
          },
          filmCode: {
            type: 'string',
            example: 'HO00012070',
            description:
              "The source system's film identifier. Kept for POS reconciliation; " +
              'there is no film table for it to resolve to.',
          },
          filmTitle: {
            type: 'string',
            nullable: true,
            example: 'Toxic: A Fairy Tale For Grown-ups',
            description: 'The title, stored on the session row itself.',
          },
          screenNumber: { type: 'integer', nullable: true, example: 5 },
          screenName: { type: 'string', nullable: true, example: 'IMAX' },
          startsAt: { type: 'string', format: 'date-time' },
          endsAt: { type: 'string', format: 'date-time' },
          status: {
            type: 'string',
            example: 'O',
            description:
              "The source system's status flag. O = open (the only bookable one), " +
              'C = closed, I = inactive.',
          },
          cinemaName: { type: 'string', nullable: true },
          cinemaId: { type: 'integer', nullable: true },
        },
      },
      ConsumerSession: {
        type: 'object',
        description:
          'A screening a customer can order against. Selecting one supplies the ' +
          "order's filmTitle and showTime.",
        properties: {
          id: {
            type: 'integer',
            example: 18757,
            description: "The source system's session id, unique within this cinema.",
          },
          screenName: {
            type: 'string',
            nullable: true,
            example: 'IMAX',
            description: 'The auditorium as the source system names it.',
          },
          screenId: {
            type: 'integer',
            nullable: true,
            example: 22,
            description:
              "QBusto's own screen id, resolved from screenName ONLY when that name " +
              'identifies exactly one active screen at the cinema. Null when no ' +
              "screen matches OR when the cinema's screen data is one row per seat " +
              'row rather than per auditorium - see seatRows below for that case. ' +
              'Not sent by the client: the order endpoint resolves the real id ' +
              'itself from screenName and seatRow.',
          },
          seatRows: {
            type: 'array',
            items: { type: 'string' },
            example: ['A', 'B', 'C'],
            description:
              'The seat rows available under this screen name, sorted, when the ' +
              "cinema's screen data is one row per seat row (screenId above is " +
              'null in that case). Empty when it is not - the row field is then ' +
              "free text. Send the row the customer picks as the order's seatRow.",
          },
          filmCode: { type: 'string', nullable: true, example: 'HO00012070' },
          filmTitle: {
            type: 'string',
            nullable: true,
            example: 'Toxic: A Fairy Tale For Grown-ups',
            description: "Send this as the order's filmTitle.",
          },
          startsAt: {
            type: 'string',
            format: 'date-time',
            description: "Send this as the order's showTime.",
          },
          endsAt: { type: 'string', format: 'date-time', nullable: true },
          isCurrent: {
            type: 'boolean',
            example: true,
            description:
              'True for the screening running RIGHT NOW on this auditorium, ' +
              'decided server-side against the server clock. At most one session ' +
              'per screen carries it. The Consumer preselects the one whose screen ' +
              "matches the QR's screenId.",
          },
        },
      },
      CategoryOrderEntry: {
        type: 'object',
        description:
          "One category's place in a cinema's display order. `sequence` 0 " +
          'means nobody has placed it, and such a category sorts after every ' +
          'placed one, alphabetically.',
        properties: {
          id: { type: 'integer', example: 7 },
          name: { type: 'string', example: 'Desserts' },
          sequence: { type: 'integer', example: 1 },
        },
      },
      OrderStatus: {
        type: 'object',
        description:
          'A row from order_statuses or payment_statuses. Address these by `code`; ' +
          'the numeric `id` is database detail and no endpoint accepts one.',
        properties: {
          id: { type: 'integer', example: 3 },
          code: { type: 'string', example: 'preparing' },
          name: { type: 'string', example: 'Preparing' },
          description: {
            type: 'string',
            nullable: true,
            example: 'Kitchen is preparing the order.',
          },
          isActive: { type: 'boolean', example: true },
        },
      },
      OrderItem: {
        type: 'object',
        description:
          'An immutable snapshot taken when the order was placed. productName, ' +
          'unitPrice and discount are frozen: renaming or repricing the product ' +
          'later does not change what the customer was charged. Money is returned ' +
          'as a JSON number - the SQL Server driver hands DECIMAL back as a ' +
          'number, and this contract states what the API actually sends.',
        properties: {
          id: { type: 'integer', example: 54 },
          orderId: { type: 'integer', example: 30 },
          productId: { type: 'integer', example: 17 },
          productName: {
            type: 'string',
            example: 'Salted Popcorn',
            description: "The product's name at the time of the order.",
          },
          posItemId: {
            type: 'string',
            nullable: true,
            description: 'Set by the POS integration phase. Null otherwise.',
          },
          quantity: { type: 'integer', example: 2 },
          unitPrice: { type: 'number', format: 'double', example: 250 },
          discount: {
            type: 'number',
            format: 'double',
            example: 50,
            description: 'Total discount for the line, not per unit.',
          },
          total: {
            type: 'number',
            format: 'double',
            example: 450,
            description: 'quantity x unitPrice - discount.',
          },
        },
      },
      KitchenOrder: {
        type: 'object',
        description:
          'An order as a kitchen screen sees it. Deliberately narrower than `Order`: ' +
          'a KDS hangs on a wall where anyone can read it, so customer mobile, ' +
          'customer email and the gateway_* identifiers are not included. ' +
          'Only orders that are paid and in a kitchen-owned fulfilment status are ' +
          'ever returned. Money is a JSON number, as elsewhere in this API.',
        properties: {
          id: {
            type: 'integer',
            example: 128,
            description: 'Also the token number a cook calls out - the schema has no separate one.',
          },
          status: {
            type: 'string',
            enum: ['confirmed', 'preparing', 'ready', 'delivered'],
            example: 'preparing',
            description: 'Fulfilment status code. Independent of paymentStatus.',
          },
          paymentStatus: {
            type: 'string',
            example: 'paid',
            description:
              'Always `paid` in practice, since nothing else is eligible. Returned so a ' +
              'screen can display it rather than assert it.',
          },
          source: {
            type: 'string',
            nullable: true,
            enum: ['qr', 'seat_qr', 'kiosk', 'counter'],
            example: 'seat_qr',
          },
          seatNumber: { type: 'string', nullable: true, example: 'G12' },
          filmTitle: { type: 'string', nullable: true, example: 'Avengers Endgame' },
          showTime: { type: 'string', format: 'date-time', nullable: true },
          notes: {
            type: 'string',
            nullable: true,
            description:
              'Order-level special instructions. The schema has no per-item modifier ' +
              'or combo composition, so this is the only free text an order carries.',
          },
          total: { type: 'number', format: 'double', example: 450 },
          cinema: {
            type: 'object',
            nullable: true,
            properties: {
              id: { type: 'integer' },
              name: { type: 'string' },
            },
          },
          screen: {
            type: 'object',
            nullable: true,
            description: 'Null for counter and kiosk orders, which are not screen-specific.',
            properties: {
              id: { type: 'integer' },
              name: { type: 'string', example: 'Audi 3' },
            },
          },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                productId: { type: 'integer' },
                productName: { type: 'string', example: 'Large Popcorn' },
                quantity: { type: 'integer', example: 2 },
                unitPrice: { type: 'number', format: 'double' },
                total: { type: 'number', format: 'double' },
              },
            },
          },
          placedAt: {
            type: 'string',
            format: 'date-time',
            description: "The order's created_at. Elapsed time is derived from this client-side.",
          },
          updatedAt: { type: 'string', format: 'date-time' },
          deliveredAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      OrderStatusLog: {
        type: 'object',
        description:
          'One entry in an order status or payment status audit trail. ' +
          'Append-only: it has a createdAt and no updatedAt.',
        properties: {
          id: { type: 'integer', example: 71 },
          orderId: { type: 'integer', example: 30 },
          previousStatusId: {
            type: 'integer',
            nullable: true,
            description: 'Null on the opening entry, where the order came from no status.',
          },
          previousStatus: { type: 'string', nullable: true, example: 'confirmed' },
          newStatusId: { type: 'integer', example: 3 },
          newStatus: { type: 'string', example: 'preparing' },
          changedByUserId: { type: 'integer', nullable: true, example: 7 },
          reason: { type: 'string', nullable: true, example: 'Customer changed their mind' },
          gatewayPaymentId: {
            type: 'string',
            nullable: true,
            description:
              'Payment logs only, and always null in this phase - the staff-operated ' +
              'payment endpoint takes no gateway identifiers.',
          },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Order: {
        type: 'object',
        description:
          'An order as it appears in a list. Money is returned as a JSON number - ' +
          'the SQL Server driver hands DECIMAL back as a number, and this contract ' +
          'states what the API actually sends. `status` and `paymentStatus` are ' +
          'status codes; the numeric id columns beside them are database detail.',
        properties: {
          id: { type: 'integer', example: 30 },
          cinemaId: { type: 'integer', example: 3 },
          screenId: { type: 'integer', nullable: true, example: 8 },
          seatNumber: { type: 'string', nullable: true, example: 'H12' },
          statusId: { type: 'integer', example: 3 },
          status: {
            type: 'string',
            enum: ['initiated', 'confirmed', 'preparing', 'ready', 'delivered', 'rejected'],
            example: 'preparing',
          },
          statusDetail: { $ref: '#/components/schemas/OrderStatus' },
          paymentStatusId: { type: 'integer', example: 1 },
          paymentStatus: {
            type: 'string',
            enum: ['pending', 'paid', 'failed', 'refunded'],
            example: 'pending',
          },
          paymentStatusDetail: { $ref: '#/components/schemas/OrderStatus' },
          source: {
            type: 'string',
            enum: ['qr', 'seat_qr', 'kiosk', 'counter'],
            nullable: true,
            example: 'seat_qr',
          },
          customerMobile: { type: 'string', nullable: true, example: '9876543210' },
          customerEmail: { type: 'string', nullable: true },
          filmTitle: { type: 'string', nullable: true, example: 'Dune: Part Two' },
          showTime: { type: 'string', format: 'date-time', nullable: true },
          subtotal: {
            type: 'number',
            format: 'double',
            example: 500,
            description: 'Sum of quantity x unitPrice across the items. Calculated server-side.',
          },
          discount: { type: 'number', format: 'double', example: 50 },
          total: {
            type: 'number',
            format: 'double',
            example: 450,
            description: 'subtotal - discount.',
          },
          smsStatus: {
            type: 'string',
            enum: ['pending', 'success', 'failed'],
            nullable: true,
            description: 'Null means the channel was not applicable or not enabled.',
          },
          whatsappStatus: {
            type: 'string',
            enum: ['pending', 'success', 'failed'],
            nullable: true,
          },
          gatewayOrderId: {
            type: 'string',
            nullable: true,
            description: "The payment gateway's order identifier. Null before payment-init runs.",
          },
          gatewayPaymentId: { type: 'string', nullable: true },
          notes: { type: 'string', nullable: true },
          deliveredAt: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Stamped when the order moves to `delivered`.',
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          cinema: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              code: { type: 'string' },
              name: { type: 'string' },
            },
          },
          screen: {
            type: 'object',
            nullable: true,
            properties: { id: { type: 'integer' }, name: { type: 'string' } },
          },
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/OrderItem' },
          },
        },
      },
      OrderDetail: {
        allOf: [
          { $ref: '#/components/schemas/Order' },
          {
            type: 'object',
            description: 'Adds both audit trails, oldest entry first.',
            properties: {
              statusLogs: {
                type: 'array',
                items: { $ref: '#/components/schemas/OrderStatusLog' },
              },
              paymentStatusLogs: {
                type: 'array',
                items: { $ref: '#/components/schemas/OrderStatusLog' },
              },
            },
          },
        ],
      },
      LoginResult: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'Signed JWT. Send as `Authorization: Bearer`.' },
          expiresIn: { type: 'string', example: '1d' },
          user: { $ref: '#/components/schemas/User' },
        },
      },
    },
    responses: {
      BadRequest: {
        description: 'Request validation failed',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
      Unauthorized: {
        description: 'Missing, malformed or expired access token',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
      Forbidden: {
        description: 'Authenticated, but not permitted to perform this action',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
      NotFound: {
        description: 'Resource not found',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
      Conflict: {
        description: 'Request conflicts with current state',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
    },
  },
  // Endpoints are protected by default; public ones opt out with `security: []`.
  security: [{ bearerAuth: [] }],
};

/** Build the full spec by scanning route files for @openapi blocks. */
function buildSpec() {
  return swaggerJsdoc({ definition, apis });
}

module.exports = { buildSpec };

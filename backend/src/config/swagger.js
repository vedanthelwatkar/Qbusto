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
          activeSince: { type: 'string', format: 'date-time', nullable: true },
          smsEnabled: { type: 'boolean', example: false },
          whatsappEnabled: { type: 'boolean', example: false },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
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
          'Discount amounts are only meaningful when discountType is set.',
        properties: {
          id: { type: 'integer', example: 22 },
          cinemaId: { type: 'integer', example: 3 },
          productId: { type: 'integer', example: 17 },
          dayOfWeek: {
            type: 'integer',
            minimum: 0,
            maximum: 7,
            example: 0,
            description: '0 = every day, 1 = Monday ... 7 = Sunday.',
          },
          basePrice: { type: 'number', format: 'double', example: 250 },
          discountType: {
            type: 'string',
            enum: ['P', 'F'],
            nullable: true,
            example: 'P',
            description: 'P = percentage, F = flat amount.',
          },
          discountValue: { type: 'number', format: 'double', nullable: true, example: 10 },
          discountOnQr: { type: 'number', format: 'double', nullable: true },
          discountOnKiosk: { type: 'number', format: 'double', nullable: true },
          discountOnSeatQr: { type: 'number', format: 'double', nullable: true },
          discountOnCounter: { type: 'number', format: 'double', nullable: true },
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
          'customer email and the razorpay_* identifiers are not included. ' +
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
          razorpayPaymentId: {
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
          razorpayOrderId: {
            type: 'string',
            nullable: true,
            description: 'Written by the Razorpay integration phase. Null otherwise.',
          },
          razorpayPaymentId: { type: 'string', nullable: true },
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

// backend/scripts/generate-openapi.js
const swaggerJsdoc = require('swagger-jsdoc');
const fs = require('fs');
const path = require('path');

const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: { title: 'Cinema Ordering API', version: '1.0.0' },
    servers: [{ url: 'http://localhost:4000/api' }],
  },
  apis: ['./routes/*.js'], // reads @openapi JSDoc comments from your route files
});

fs.writeFileSync(
  path.join(__dirname, '../../shared/openapi.json'),
  JSON.stringify(spec, null, 2)
);

console.log('openapi.json generated at shared/openapi.json');
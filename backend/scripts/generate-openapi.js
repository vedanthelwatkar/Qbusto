// backend/scripts/generate-openapi.js
//
// Writes the OpenAPI spec to shared/openapi.json, which the consumer, dashboard
// and kitchen apps turn into typed API clients via orval (`make gen-api`).
//
// The definition and the route-scanning globs live in src/config/swagger.js and
// are shared with the runtime docs served at /api/docs, so the generated client
// and the browsable docs cannot drift apart.

const fs = require('fs');
const path = require('path');

const { buildSpec } = require('../src/config/swagger');

const spec = buildSpec();
const outPath = path.join(__dirname, '../../shared/openapi.json');

fs.writeFileSync(outPath, JSON.stringify(spec, null, 2));

const pathCount = Object.keys(spec.paths || {}).length;
console.log(`openapi.json generated at shared/openapi.json (${pathCount} paths)`);

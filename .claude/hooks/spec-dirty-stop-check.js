const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input || '{}');
    const projectDir = payload.cwd || process.cwd();
    const markerPath = path.join(projectDir, '.claude', '.spec-dirty');
    if (fs.existsSync(markerPath)) {
      process.stderr.write(
        'A backend route file was edited this session but the OpenAPI spec ' +
        'and generated API clients have not been regenerated.\n' +
        'Run `make gen-api` (or the /gen-api skill), then delete ' +
        '.claude/.spec-dirty, before finishing.\n'
      );
      process.exit(2);
    }
  } catch {
    // if we can't even check, don't block completion over it
  }
  process.exit(0);
});

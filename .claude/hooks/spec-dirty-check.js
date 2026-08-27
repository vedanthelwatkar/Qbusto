const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input || '{}');
    const filePath = payload?.tool_input?.file_path || '';
    const normalized = filePath.replace(/\\/g, '/');
    const isBackendRoute = /(^|\/)backend\/src\/routes\/.+\.js$/.test(normalized);
    if (isBackendRoute) {
      const projectDir = payload.cwd || process.cwd();
      const markerPath = path.join(projectDir, '.claude', '.spec-dirty');
      fs.writeFileSync(markerPath, `route file edited: ${filePath}\n`, { flag: 'a' });
    }
  } catch {
    // never fail the tool call over this hook
  }
  process.exit(0);
});

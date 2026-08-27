const path = require('path');
const { execFileSync } = require('child_process');

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input || '{}');
    const filePath = payload?.tool_input?.file_path || '';
    const normalized = filePath.replace(/\\/g, '/');
    const projectDir = payload.cwd || process.cwd();

    const match = normalized.match(/(^|.*\/)(consumer|dashboard|kitchen)\/src\/.+\.tsx?$/);
    if (match) {
      const app = match[2];
      const appDir = path.join(projectDir, app);
      const absoluteFile = path.isAbsolute(filePath)
        ? filePath
        : path.join(projectDir, filePath);

      // dashboard has prettier (npm run format); consumer/kitchen only have eslint.
      const useFormatter = app === 'dashboard' ? 'prettier' : 'eslint';
      try {
        const args = useFormatter === 'prettier'
          ? ['prettier', '--write', absoluteFile]
          : ['eslint', '--fix', absoluteFile];
        // shell: true is required on Windows - npx resolves to npx.cmd, which
        // execFileSync cannot exec directly without going through a shell.
        execFileSync('npx', args, {
          cwd: appDir,
          stdio: 'ignore',
          shell: true,
        });
      } catch {
        // formatter missing or found lint errors it can't autofix - never fail the hook
      }
    }
  } catch {
    // malformed payload - never fail the tool call over this hook
  }
  process.exit(0);
});

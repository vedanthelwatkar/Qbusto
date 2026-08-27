let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input || '{}');
    const filePath = payload?.tool_input?.file_path || '';
    const normalized = filePath.replace(/\\/g, '/');
    if (/(^|\/)backend\/src\/constants\.js$/.test(normalized)) {
      process.stdout.write(
        'Reminder: backend/src/constants.js mirrors DB CHECK constraints ' +
        '(MODULES, ROLES, ACTIONS, ORDER_STATUSES, PAYMENT_STATUSES, ' +
        'ORDER_SOURCES, POS_PROVIDERS). If the schema changed, update both ' +
        'in the same change.\n'
      );
    }
  } catch {
    // never fail the tool call over this hook
  }
  process.exit(0);
});

const { spawnSync } = require('node:child_process');

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    // eslint-disable-next-line no-console
    console.error(result.error);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

// Apply migrations at runtime (Railway provides DATABASE_URL at runtime).
run('npx', ['prisma', 'migrate', 'deploy']);

// Start the compiled server.
run('node', ['dist/index.js']);

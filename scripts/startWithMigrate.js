const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function run(command, args) {
  const isWindowsCmd =
    process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
  const effectiveCommand = isWindowsCmd ? 'cmd.exe' : command;
  const effectiveArgs = isWindowsCmd ? ['/c', command, ...args] : args;

  const runResult = spawnSync(effectiveCommand, effectiveArgs, {
    stdio: 'inherit',
    env: process.env,
  });

  if (runResult.error) {
    // eslint-disable-next-line no-console
    console.error(runResult.error);
    process.exit(1);
  }

  if (typeof runResult.status === 'number' && runResult.status !== 0) {
    process.exit(runResult.status);
  }
}

function resolvePrismaCommand() {
  const prismaBinName = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
  const prismaLocalPath = path.join(
    __dirname,
    '..',
    'node_modules',
    '.bin',
    prismaBinName,
  );

  if (fs.existsSync(prismaLocalPath)) {
    return {
      command: prismaLocalPath,
      args: ['migrate', 'deploy'],
    };
  }

  return {
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['prisma', 'migrate', 'deploy'],
  };
}

// Apply migrations at runtime (Railway provides DATABASE_URL at runtime).
const prismaCommand = resolvePrismaCommand();
run(prismaCommand.command, prismaCommand.args);

// Start the compiled server.
run('node', ['dist/index.js']);

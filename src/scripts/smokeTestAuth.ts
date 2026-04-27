import bcrypt from 'bcryptjs';
import { spawn, type ChildProcess } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';
import prisma from '../config/database';

dotenv.config();

type LoginResponse = {
  success: boolean;
  token?: string;
  tokenType?: string;
  expiresIn?: string;
  user?: Record<string, unknown>;
  tenant?: Record<string, unknown>;
  entitlements?: Record<string, unknown>;
  subscription?: Record<string, unknown>;
  error?: string;
};

type EntitlementsResponse = {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveBaseUrl(): string {
  const explicit = (process.env.SMOKE_TEST_BASE_URL ?? '').trim();
  if (explicit.length > 0) {
    return explicit.replace(/\/$/, '');
  }
  const port = (process.env.PORT ?? '5000').trim() || '5000';
  return `http://127.0.0.1:${port}`;
}

async function isServerReachable(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(baseUrl: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isServerReachable(baseUrl)) {
      return;
    }
    await sleep(500);
  }
  throw new Error(`Server backend tidak merespons di ${baseUrl} dalam ${timeoutMs}ms.`);
}

function startLocalServer(baseUrl: string): ChildProcess {
  const projectRoot = path.resolve(__dirname, '../..');
  const child = spawn('node', ['dist/index.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: new URL(baseUrl).port || process.env.PORT || '5000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk) => {
    process.stderr.write(`[smokeTestAuth:server] ${chunk}`);
  });
  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`[smokeTestAuth:server] ${chunk}`);
  });

  return child;
}

async function main() {
  const baseUrl = resolveBaseUrl();
  const temporaryPassword =
    (process.env.SMOKE_TEST_PASSWORD ?? 'SmokeTest123!').trim() ||
    'SmokeTest123!';
  let startedServer: ChildProcess | null = null;

  if (!(await isServerReachable(baseUrl))) {
    startedServer = startLocalServer(baseUrl);
    await waitForServer(baseUrl, 20000);
  }

  const sampleUser = await prisma.user.findFirst({
    where: {
      role: { not: 'SUPER_ADMIN' },
      isActive: true,
      username: { not: null },
      tenant: { isActive: true },
      appAccesses: {
        some: {
          isActive: true,
          appInstance: {
            status: 'ACTIVE',
            solution: {
              code: 'POS',
            },
          },
        },
      },
    },
    include: {
      tenant: true,
      appAccesses: {
        where: {
          isActive: true,
          appInstance: {
            status: 'ACTIVE',
            solution: {
              code: 'POS',
            },
          },
        },
        include: {
          appInstance: {
            include: {
              solution: true,
            },
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  if (!sampleUser?.username || !sampleUser.tenant.slug) {
    throw new Error(
      'Tidak menemukan sample user aktif dengan akses POS dan tenant slug valid.',
    );
  }

  const originalPasswordHash = sampleUser.passwordHash;
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);

  await prisma.user.update({
    where: { id: sampleUser.id },
    data: { passwordHash },
  });

  try {
    const loginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: sampleUser.username,
        password: temporaryPassword,
        tenantSlug: sampleUser.tenant.slug,
      }),
    });

    const loginJson = (await loginResponse.json()) as LoginResponse;
    if (!loginResponse.ok || !loginJson.token) {
      throw new Error(
        `Login smoke test gagal (${loginResponse.status}): ${JSON.stringify(loginJson, null, 2)}`,
      );
    }

    const entitlementsResponse = await fetch(`${baseUrl}/auth/entitlements`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${loginJson.token}`,
      },
    });
    const entitlementsJson =
      (await entitlementsResponse.json()) as EntitlementsResponse;
    if (!entitlementsResponse.ok) {
      throw new Error(
        `Entitlements smoke test gagal (${entitlementsResponse.status}): ${JSON.stringify(entitlementsJson, null, 2)}`,
      );
    }

    console.log('=== SMOKE TEST CONTEXT ===');
    console.log(
      JSON.stringify(
        {
          baseUrl,
          username: sampleUser.username,
          tenantSlug: sampleUser.tenant.slug,
          tenantId: sampleUser.tenantId,
          appInstanceId: sampleUser.appAccesses[0]?.appInstanceId ?? null,
        },
        null,
        2,
      ),
    );

    console.log('=== LOGIN RESPONSE JSON ===');
    console.log(JSON.stringify(loginJson, null, 2));

    console.log('=== ENTITLEMENTS RESPONSE JSON ===');
    console.log(JSON.stringify(entitlementsJson, null, 2));
  } finally {
    await prisma.user.update({
      where: { id: sampleUser.id },
      data: { passwordHash: originalPasswordHash },
    });
    if (startedServer) {
      startedServer.kill();
    }
  }
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`SMOKE TEST FAILED: ${message}`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
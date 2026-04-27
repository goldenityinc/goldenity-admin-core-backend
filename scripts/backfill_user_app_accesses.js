require('dotenv').config();
const { Client } = require('pg');

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    tenantId: (() => {
      const hit = argv.find((arg) => arg.startsWith('--tenant-id='));
      return hit ? hit.split('=').slice(1).join('=').trim() : '';
    })(),
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const tenantFilterClause = args.tenantId ? 'AND u."tenantId" = $1' : '';
  const queryParams = args.tenantId ? [args.tenantId] : [];

  const candidateSql = `
    WITH preferred_instances AS (
      SELECT DISTINCT ON (ai."tenantId")
        ai.id AS "appInstanceId",
        ai."tenantId"
      FROM app_instances ai
      LEFT JOIN solutions s ON s.id = ai."solutionId"
      WHERE ai.status = 'ACTIVE'
      ORDER BY
        ai."tenantId",
        CASE
          WHEN UPPER(COALESCE(s.code, '')) = 'POS' THEN 0
          WHEN UPPER(COALESCE(s.name, '')) LIKE '%POS%' THEN 1
          ELSE 2
        END,
        ai."updatedAt" DESC,
        ai."createdAt" DESC
    )
    SELECT
      u.id AS "userId",
      u."tenantId",
      u.role::text AS "userRole",
      u."isActive" AS "userIsActive",
      pi."appInstanceId"
    FROM users u
    JOIN preferred_instances pi
      ON pi."tenantId" = u."tenantId"
    WHERE COALESCE(u.role::text, '') <> 'SUPER_ADMIN'
      ${tenantFilterClause}
  `;

  try {
    const candidateResult = await client.query(candidateSql, queryParams);
    const candidateRows = candidateResult.rows;

    if (candidateRows.length === 0) {
      console.log('No candidate users found for backfill.');
      return;
    }

    const candidatesWithAccess = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM (
        ${candidateSql}
      ) c
      JOIN user_app_accesses uaa
        ON uaa."userId" = c."userId"
       AND uaa."appInstanceId" = c."appInstanceId"
      `,
      queryParams,
    );

    const existingCount = candidatesWithAccess.rows[0]?.count ?? 0;
    const missingCount = candidateRows.length - existingCount;

    console.log('=== UserAppAccess Backfill Preview ===');
    console.table([
      {
        scope: args.tenantId ? `tenant:${args.tenantId}` : 'all-tenants',
        candidateUsers: candidateRows.length,
        alreadyLinked: existingCount,
        missingLinks: missingCount,
        mode: args.apply ? 'APPLY' : 'DRY-RUN',
      },
    ]);

    if (!args.apply) {
      console.log('Dry-run only. Re-run with --apply to execute backfill.');
      return;
    }

    await client.query('BEGIN');

    const upsertSql = `
      INSERT INTO user_app_accesses (
        id,
        "userId",
        "appInstanceId",
        role,
        "isActive",
        "createdAt",
        "updatedAt"
      )
      SELECT
        CONCAT('uaa_', md5(c."userId" || ':' || c."appInstanceId")) AS id,
        c."userId",
        c."appInstanceId",
        (
          CASE
            WHEN c."userRole" = 'TENANT_ADMIN' THEN 'ADMIN'
            WHEN c."userRole" = 'CRM_MANAGER' THEN 'MANAGER'
            WHEN c."userRole" = 'READ_ONLY' THEN 'VIEWER'
            ELSE 'STAFF'
          END
        )::"AppRole" AS role,
        COALESCE(c."userIsActive", true),
        NOW(),
        NOW()
      FROM (
        ${candidateSql}
      ) c
      ON CONFLICT ("userId", "appInstanceId")
      DO UPDATE SET
        "isActive" = EXCLUDED."isActive",
        "updatedAt" = NOW()
    `;

    const upsertResult = await client.query(upsertSql, queryParams);
    await client.query('COMMIT');

    console.log(
      `Backfill completed. Rows inserted/updated: ${upsertResult.rowCount ?? 0}`,
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Backfill failed:', error.message || error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

run();

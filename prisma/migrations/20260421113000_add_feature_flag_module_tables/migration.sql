DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'ModuleDefinitionStatus'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "ModuleDefinitionStatus" AS ENUM ('ACTIVE', 'DEPRECATED', 'ARCHIVED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'ModuleAssignmentSource'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "ModuleAssignmentSource" AS ENUM (
      'CORE',
      'BUNDLE',
      'ADDON',
      'TRIAL',
      'MANUAL_OVERRIDE'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "module_definitions" (
  "id" TEXT NOT NULL,
  "module_key" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT,
  "is_core" BOOLEAN NOT NULL DEFAULT false,
  "status" "ModuleDefinitionStatus" NOT NULL DEFAULT 'ACTIVE',
  "dependencies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "default_config" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "module_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "module_definitions_module_key_key"
  ON "module_definitions"("module_key");

CREATE INDEX IF NOT EXISTS "module_definitions_category_idx"
  ON "module_definitions"("category");

CREATE INDEX IF NOT EXISTS "module_definitions_status_idx"
  ON "module_definitions"("status");

CREATE TABLE IF NOT EXISTS "app_instance_modules" (
  "id" TEXT NOT NULL,
  "app_instance_id" TEXT NOT NULL,
  "module_definition_id" TEXT NOT NULL,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "source" "ModuleAssignmentSource" NOT NULL DEFAULT 'MANUAL_OVERRIDE',
  "billing_status" TEXT,
  "activated_at" TIMESTAMP(3),
  "expired_at" TIMESTAMP(3),
  "config" JSONB,
  "limits" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "app_instance_modules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "app_instance_modules_app_instance_id_module_definition_id_key"
  ON "app_instance_modules"("app_instance_id", "module_definition_id");

CREATE INDEX IF NOT EXISTS "app_instance_modules_app_instance_id_idx"
  ON "app_instance_modules"("app_instance_id");

CREATE INDEX IF NOT EXISTS "app_instance_modules_module_definition_id_idx"
  ON "app_instance_modules"("module_definition_id");

CREATE INDEX IF NOT EXISTS "app_instance_modules_is_enabled_idx"
  ON "app_instance_modules"("is_enabled");

CREATE INDEX IF NOT EXISTS "app_instance_modules_source_idx"
  ON "app_instance_modules"("source");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'app_instance_modules_app_instance_id_fkey'
  ) THEN
    ALTER TABLE "app_instance_modules"
    ADD CONSTRAINT "app_instance_modules_app_instance_id_fkey"
    FOREIGN KEY ("app_instance_id") REFERENCES "app_instances"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'app_instance_modules_module_definition_id_fkey'
  ) THEN
    ALTER TABLE "app_instance_modules"
    ADD CONSTRAINT "app_instance_modules_module_definition_id_fkey"
    FOREIGN KEY ("module_definition_id") REFERENCES "module_definitions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
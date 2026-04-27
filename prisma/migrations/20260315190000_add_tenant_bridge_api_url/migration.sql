-- Add bridge API URL per tenant for SaaS multi-tenant bridge routing
ALTER TABLE "tenants"
ADD COLUMN "bridge_api_url" TEXT;

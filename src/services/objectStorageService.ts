import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { AppError } from '../utils/AppError';

type StorageConfig = {
  bucket: string;
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
};

let hasLoggedStorageConfig = false;

function sanitizeEnvValue(raw?: string): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }

  const cleaned = raw.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function firstEnvValue(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = sanitizeEnvValue(process.env[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function getStorageConfig(runtimeBucket?: string): StorageConfig {
  const bucket = firstEnvValue([
    'STORAGE_BUCKET',
    'AWS_S3_BUCKET_NAME',
    'AWS_BUCKET_NAME',
    'BUCKET_NAME',
    'S3_BUCKET',
    'STORAGE_BUCKET_NAME',
    'S3_BUCKET_NAME',
    'R2_BUCKET',
    'BUCKET',
    'AWS_S3_BUCKET',
    'AWS_BUCKET',
  ]) || sanitizeEnvValue(runtimeBucket);
  const region =
    firstEnvValue([
      'STORAGE_REGION',
      'AWS_REGION',
      'AWS_DEFAULT_REGION',
      'S3_REGION',
    ]) || 'auto';
  const endpoint = firstEnvValue([
    'STORAGE_ENDPOINT',
    'AWS_ENDPOINT_URL',
    'AWS_S3_ENDPOINT',
    'S3_ENDPOINT',
    'AWS_ENDPOINT',
    'R2_ENDPOINT',
    'S3_URL',
  ]);
  const accessKeyId = firstEnvValue([
    'STORAGE_ACCESS_KEY',
    'STORAGE_ACCESS_KEY_ID',
    'AWS_ACCESS_KEY_ID',
    'AWS_ACCESS_KEY',
    'S3_ACCESS_KEY_ID',
    'S3_ACCESS_KEY',
    'AWS_S3_ACCESS_KEY_ID',
    'AWS_S3_ACCESS_KEY',
    'ACCESS_KEY',
  ]);
  const secretAccessKey = firstEnvValue([
    'STORAGE_SECRET_KEY',
    'STORAGE_SECRET_ACCESS_KEY',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SECRET_KEY',
    'S3_SECRET_ACCESS_KEY',
    'S3_SECRET_KEY',
    'AWS_S3_SECRET_ACCESS_KEY',
    'AWS_S3_SECRET_KEY',
    'SECRET_KEY',
  ]);
  const publicBaseUrl = firstEnvValue([
    'STORAGE_PUBLIC_BASE_URL',
    'S3_PUBLIC_BASE_URL',
    'AWS_S3_PUBLIC_BASE_URL',
  ]);

  if (!bucket) {
    throw new AppError(
      'Storage bucket belum dikonfigurasi. Set STORAGE_BUCKET (atau S3_BUCKET / BUCKET_NAME / R2_BUCKET).',
      503,
    );
  }
  if (!accessKeyId || !secretAccessKey) {
    throw new AppError(
      'Storage credential belum dikonfigurasi. Set STORAGE_ACCESS_KEY/STORAGE_SECRET_KEY (atau AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY).',
      503,
    );
  }
  if (!endpoint) {
    throw new AppError('Storage endpoint belum dikonfigurasi. Set STORAGE_ENDPOINT untuk S3-compatible storage.', 503);
  }

  if (!hasLoggedStorageConfig) {
    hasLoggedStorageConfig = true;
    console.log(`[ObjectStorage] bucket="${bucket}" endpoint="${endpoint}" region="${region}"`);
  }

  return {
    bucket,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl,
  };
}

function createS3Client(cfg: StorageConfig): S3Client {
  return new S3Client({
    region: cfg.region,
    forcePathStyle: true,
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export class ObjectStorageService {
  static async putPublicObject(input: { key: string; body: Buffer; contentType: string }): Promise<{ url: string; key: string }>
  {
    const runtimeBucketHint = input.key.split('/')[0];
    const cfg = getStorageConfig(runtimeBucketHint);
    const s3 = createS3Client(cfg);

    await s3.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );

    const url = cfg.publicBaseUrl
      ? joinUrl(cfg.publicBaseUrl, input.key)
      : joinUrl(cfg.endpoint, `/${cfg.bucket}/${input.key}`);

    return { url, key: input.key };
  }

  static async getObject(input: { key: string }): Promise<{ body: unknown; contentType?: string; cacheControl?: string }> {
    const runtimeBucketHint = input.key.split('/')[0];
    const cfg = getStorageConfig(runtimeBucketHint);
    const s3 = createS3Client(cfg);

    const res = await s3.send(
      new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: input.key,
      }),
    );

    return {
      body: res.Body,
      contentType: typeof res.ContentType === 'string' ? res.ContentType : undefined,
      cacheControl:
        typeof res.CacheControl === 'string' ? res.CacheControl : undefined,
    };
  }
}

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { AppError } from '../utils/AppError';

type StorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
};

function getStorageConfig(): StorageConfig {
  const bucket = process.env.STORAGE_BUCKET?.trim() || process.env.S3_BUCKET?.trim();
  const region = process.env.STORAGE_REGION?.trim() || process.env.S3_REGION?.trim() || 'auto';
  const endpoint = process.env.STORAGE_ENDPOINT?.trim() || process.env.S3_ENDPOINT?.trim() || undefined;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID?.trim() || process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY?.trim() || process.env.S3_SECRET_ACCESS_KEY?.trim();
  const publicBaseUrl = process.env.STORAGE_PUBLIC_BASE_URL?.trim() || process.env.S3_PUBLIC_BASE_URL?.trim() || undefined;

  if (!bucket) throw new AppError('Storage bucket belum dikonfigurasi (STORAGE_BUCKET)', 503);
  if (!accessKeyId || !secretAccessKey) {
    throw new AppError('Storage credential belum dikonfigurasi (STORAGE_ACCESS_KEY_ID/SECRET)', 503);
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
    const cfg = getStorageConfig();
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
      : cfg.endpoint
        ? joinUrl(cfg.endpoint, `/${cfg.bucket}/${input.key}`)
        : `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${input.key}`;

    return { url, key: input.key };
  }
}

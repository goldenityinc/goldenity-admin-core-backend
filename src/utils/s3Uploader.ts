import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

type S3UploadResult = {
  key: string;
  url: string;
};

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

export function isS3Configured(): boolean {
  const bucket = firstEnvValue([
    'AWS_BUCKET_NAME',
    'AWS_S3_BUCKET_NAME',
    'S3_BUCKET_NAME',
    'STORAGE_BUCKET_NAME',
    'STORAGE_BUCKET',
  ]);
  const accessKeyId = firstEnvValue([
    'AWS_ACCESS_KEY_ID',
    'AWS_ACCESS_KEY',
    'AWS_S3_ACCESS_KEY_ID',
    'S3_ACCESS_KEY_ID',
    'STORAGE_ACCESS_KEY_ID',
    'STORAGE_ACCESS_KEY',
  ]);
  const secretAccessKey = firstEnvValue([
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SECRET_KEY',
    'AWS_S3_SECRET_ACCESS_KEY',
    'S3_SECRET_ACCESS_KEY',
    'STORAGE_SECRET_ACCESS_KEY',
    'STORAGE_SECRET_KEY',
  ]);
  const endpoint = firstEnvValue([
    'AWS_ENDPOINT',
    'AWS_ENDPOINT_URL',
    'AWS_S3_ENDPOINT',
    'S3_ENDPOINT',
    'STORAGE_ENDPOINT',
  ]);
  return Boolean(bucket && accessKeyId && secretAccessKey && endpoint);
}

function getS3Config() {
  const bucket = firstEnvValue([
    'AWS_BUCKET_NAME',
    'AWS_S3_BUCKET_NAME',
    'S3_BUCKET_NAME',
    'STORAGE_BUCKET_NAME',
    'STORAGE_BUCKET',
  ]);
  const region = firstEnvValue([
    'AWS_REGION',
    'AWS_DEFAULT_REGION',
    'S3_REGION',
    'STORAGE_REGION',
  ]) || 'auto';
  const endpoint = firstEnvValue([
    'AWS_ENDPOINT',
    'AWS_ENDPOINT_URL',
    'AWS_S3_ENDPOINT',
    'S3_ENDPOINT',
    'STORAGE_ENDPOINT',
  ]);
  const accessKeyId = firstEnvValue([
    'AWS_ACCESS_KEY_ID',
    'AWS_ACCESS_KEY',
    'AWS_S3_ACCESS_KEY_ID',
    'S3_ACCESS_KEY_ID',
    'STORAGE_ACCESS_KEY_ID',
    'STORAGE_ACCESS_KEY',
  ]);
  const secretAccessKey = firstEnvValue([
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SECRET_KEY',
    'AWS_S3_SECRET_ACCESS_KEY',
    'S3_SECRET_ACCESS_KEY',
    'STORAGE_SECRET_ACCESS_KEY',
    'STORAGE_SECRET_KEY',
  ]);

  if (!bucket) {
    throw new Error('AWS bucket belum dikonfigurasi. Set AWS_BUCKET_NAME.');
  }
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Credential S3 belum dikonfigurasi. Set AWS_ACCESS_KEY_ID dan AWS_SECRET_ACCESS_KEY.');
  }
  if (!endpoint) {
    throw new Error('Endpoint S3 belum dikonfigurasi. Set AWS_ENDPOINT untuk S3-compatible storage.');
  }

  return {
    bucket,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
  };
}

function createS3Client() {
  const cfg = getS3Config();
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

function buildProxyUrl(key: string): string {
  const encodedKey = key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('%2F');

  return `/images/${encodedKey}`;
}

function buildUniqueObjectKey(fileName: string): string {
  const normalized = fileName.replace(/^\/+/, '').trim();
  if (!normalized) {
    throw new Error('Nama file upload tidak valid');
  }

  const directory = path.posix.dirname(normalized);
  const baseName = path.posix.basename(normalized);
  const uniqueBaseName = `${Date.now()}-${randomUUID()}-${baseName}`;

  if (!directory || directory === '.') {
    return uniqueBaseName;
  }

  return `${directory}/${uniqueBaseName}`;
}

function inferLocalExtension(mimeType: string): string {
  const normalized = (mimeType || '').trim().toLowerCase();
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/gif') return 'gif';
  return 'bin';
}

async function uploadToLocalFs(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<S3UploadResult> {
  const normalizedDir = fileName.replace(/^\/+/, '').trim() || 'expenses/upload';
  const ext = inferLocalExtension(mimeType);
  const dirPath = path.posix.dirname(normalizedDir) || 'expenses';
  const baseNoExt = path
    .basename(path.posix.basename(normalizedDir))
    .replace(/\.[^.]+$/, '');
  const publicRoot = path.resolve(process.cwd(), 'public');
  const uploadsDir = path.resolve(publicRoot, 'uploads', dirPath);
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  const finalBaseName = `${Date.now()}-${randomUUID()}-${baseNoExt || 'upload'}.${ext}`;
  const finalFullPath = path.join(uploadsDir, finalBaseName);
  fs.writeFileSync(finalFullPath, fileBuffer);
  const relativeUrl = `/uploads/${dirPath.replace(/^\/+/, '')}/${finalBaseName}`;
  return {
    key: relativeUrl,
    url: relativeUrl,
  };
}

export async function uploadToS3(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<S3UploadResult> {
  if (!isS3Configured()) {
    return uploadToLocalFs(fileBuffer, fileName, mimeType);
  }

  const key = buildUniqueObjectKey(fileName);

  const client = createS3Client();
  const cfg = getS3Config();

  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
    }),
  );

  return {
    key,
    url: buildProxyUrl(key),
  };
}

export function decodeProxyUrlPath(encodedPath: string): string {
  const normalized = encodedPath
    .split('/')
    .map((seg) => seg.trim())
    .filter(Boolean)
    .join('/');

  if (!normalized.includes('%2F') && !normalized.includes('%')) {
    return normalized;
  }

  try {
    return normalized
      .split('%2F')
      .map((part) => decodeURIComponent(part))
      .join('/');
  } catch {
    try {
      return decodeURIComponent(normalized);
    } catch {
      return normalized.replace(/%2F/g, '/');
    }
  }
}

export type S3StreamResult = {
  body: Readable | undefined;
  contentType: string | undefined;
  contentLength: number | undefined;
  etag: string | undefined;
  lastModified: Date | undefined;
};

export async function streamFromS3(
  keyOrProxyPath: string,
): Promise<S3StreamResult | null> {
  if (!isS3Configured()) {
    return null;
  }

  const key = keyOrProxyPath.includes('%2F')
    ? decodeProxyUrlPath(keyOrProxyPath)
    : keyOrProxyPath;

  if (!key) {
    return null;
  }

  try {
    const client = createS3Client();
    const cfg = getS3Config();
    const resp = await client.send(
      new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
      }),
    );

    return {
      body: resp.Body as Readable | undefined,
      contentType: resp.ContentType,
      contentLength: resp.ContentLength,
      etag: resp.ETag,
      lastModified: resp.LastModified,
    };
  } catch {
    return null;
  }
}
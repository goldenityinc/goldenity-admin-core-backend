/**
 * Image URL Transform Utility (TypeScript)
 * Converts S3 URLs to Image Proxy URLs for private buckets
 */

const PROXY_BASE = process.env.IMAGE_PROXY_BASE || '/images';

/**
 * Extract storage key from S3 URL or return original if already a proxy URL
 */
export function extractS3KeyFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') {
    return null;
  }

  // Already a proxy URL or relative path
  if (url.startsWith('/images/')) {
    return url;
  }

  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    let key = pathname;
    const parts = pathname.split('/').filter(Boolean);

    if (parts.length > 1) {
      key = '/' + parts.slice(1).join('/');
    } else if (parts.length === 1) {
      key = '/' + parts[0];
    }

    return key.startsWith('/') ? key.substring(1) : key;
  } catch (e) {
    const match = url.match(/\/([^/]+?)\/(.+)$/);
    if (match) {
      return match[2];
    }
    return url;
  }
}

/**
 * Convert S3 URL to Proxy URL
 */
export function toProxyUrl(s3Url: string | null | undefined): string | null {
  if (!s3Url) {
    return null;
  }

  if (s3Url.startsWith('/images/')) {
    return s3Url;
  }

  const key = extractS3KeyFromUrl(s3Url);
  if (!key) {
    return s3Url;
  }

  const encoded = key
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('%2F');

  return `${PROXY_BASE}/${encoded}`;
}

/**
 * Transform object URLs in data structure
 */
export function transformImageUrlsInObject(
  obj: unknown,
  imageFields: string[] = ['imageUrl', 'image_url', 'logo_url', 'photo_url'],
): unknown {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => transformImageUrlsInObject(item, imageFields));
  }

  const transformed = { ...obj };
  const record = transformed as any;

  imageFields.forEach(field => {
    if (record[field] && typeof record[field] === 'string') {
      record[field] = toProxyUrl(record[field]);
    }
  });

  return transformed;
}

export const IMAGE_TRANSFORM = {
  toProxyUrl,
  transformImageUrlsInObject,
  extractS3KeyFromUrl,
  PROXY_BASE,
};

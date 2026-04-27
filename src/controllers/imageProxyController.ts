import { Request, Response } from 'express';
import { getObjectStorageClient, getStorageConfig } from '../services/objectStorageService';
import { GetObjectCommand } from '@aws-sdk/client-s3';

/**
 * Image Proxy Controller (TypeScript)
 * Streams images from S3-compatible storage to client
 * Solves 403 Forbidden issue when bucket is private
 */

const mimeTypeMap: { [key: string]: string } = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function getMimeType(key: string): string {
  const ext = key.toLowerCase().substring(key.lastIndexOf('.'));
  return mimeTypeMap[ext] || 'application/octet-stream';
}

export async function serveImage(req: Request, res: Response): Promise<void> {
  try {
    const { encodedKey } = req.params;
    if (!encodedKey) {
      res.status(400).json({ error: 'Key is required' });
      return;
    }

    // Decode the key
    let key: string;
    try {
      key = decodeURIComponent(encodedKey);
    } catch (e) {
      res.status(400).json({ error: 'Invalid key encoding' });
      return;
    }

    // Security: Prevent path traversal
    if (key.includes('..') || key.startsWith('/')) {
      res.status(400).json({ error: 'Invalid key format' });
      return;
    }

    const client = getObjectStorageClient();
    if (!client) {
      res.status(500).json({ error: 'Storage not configured' });
      return;
    }

    const cfg = getStorageConfig();
    const command = new GetObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
    });

    const response = await client.send(command);

    // Set cache headers
    const cacheTime = key.includes('logo') ? 3600 : 86400;
    res.set({
      'Content-Type': getMimeType(key),
      'Cache-Control': `public, max-age=${cacheTime}`,
      'Content-Length': response.ContentLength?.toString() || '',
      'ETag': response.ETag || '',
    });

    // Pipe stream directly to response
    if (response.Body && typeof response.Body === 'object' && 'pipe' in response.Body) {
      (response.Body as any).pipe(res);

      (response.Body as any).on('error', (error: Error) => {
        console.error('Stream error for key', key, ':', error.message);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to stream image' });
        }
      });
    } else {
      res.status(500).json({ error: 'Invalid response body' });
    }
  } catch (error) {
    console.error('Image proxy error:', error instanceof Error ? error.message : String(error));

    const err = error as any;
    if (err.Code === 'NoSuchKey' || err.name === 'NoSuchKey') {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    if (err.Code === 'AccessDenied' || err.name === 'AccessDenied') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to serve image' });
    }
  }
}

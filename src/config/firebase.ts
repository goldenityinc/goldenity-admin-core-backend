import admin from 'firebase-admin';
import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import dotenv from 'dotenv';

dotenv.config();

// Firebase hanya dipakai sebagai jalur login LAMA Super Admin (masa transisi).
// Login Super Admin sekarang lewat backend (POST /api/auth/admin/login, JWT internal).
// Jika variabel FIREBASE_* tidak diisi, backend tetap jalan dan token Firebase ditolak.
function isFirebaseConfigured(): boolean {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID?.trim() &&
      process.env.FIREBASE_CLIENT_EMAIL?.trim() &&
      process.env.FIREBASE_PRIVATE_KEY?.trim(),
  );
}

let cachedAuth: Auth | null | undefined;

export function getFirebaseAuth(): Auth | null {
  if (cachedAuth !== undefined) return cachedAuth;
  if (!isFirebaseConfigured()) {
    cachedAuth = null;
    return cachedAuth;
  }
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  cachedAuth = admin.auth();
  return cachedAuth;
}

export class FirebaseNotConfiguredError extends Error {
  code = 'auth/not-configured';
  constructor() {
    super('Login Firebase sudah tidak dipakai. Silakan login ulang.');
  }
}

/** Verifikasi token Firebase lama; melempar FirebaseNotConfiguredError bila Firebase tidak diatur. */
export const firebaseAuth = {
  async verifyIdToken(token: string): Promise<DecodedIdToken> {
    const auth = getFirebaseAuth();
    if (!auth) throw new FirebaseNotConfiguredError();
    return auth.verifyIdToken(token);
  },
};

export default admin;

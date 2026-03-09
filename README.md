# Goldenity Admin Core API

Backend RESTful API Multi-Tenant untuk Dashboard Admin Goldenity.

## 🛠️ Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Language:** TypeScript
- **ORM:** Prisma
- **Database:** PostgreSQL
- **Authentication:** Firebase Auth
- **Validation:** Zod

## 🏗️ Arsitektur Multi-Tenant

Sistem ini menggunakan arsitektur **Multi-Tenant Single Database**, di mana:
- Satu database PostgreSQL digunakan untuk semua klien
- Setiap data memiliki `tenantId` untuk isolasi antar klien
- Middleware otomatis memfilter data berdasarkan tenant user yang login

## 📦 Langkah 1: Instalasi Dependencies

Jalankan perintah berikut di terminal:

```powershell
# Install semua dependencies
npm install

# Atau jika menggunakan yarn
yarn install
```

### Dependencies yang terinstall:
- **express** - Web framework
- **cors** - Cross-Origin Resource Sharing
- **dotenv** - Environment variables
- **firebase-admin** - Firebase Admin SDK untuk verifikasi token
- **zod** - Schema validation
- **@prisma/client** - Prisma Client untuk database operations

### Dev Dependencies:
- **typescript** - TypeScript compiler
- **ts-node** - TypeScript execution
- **nodemon** - Auto-restart development server
- **prisma** - Prisma CLI
- **@types/*** - Type definitions

## 🗄️ Langkah 2: Setup Database

### 2.1 Install PostgreSQL

Pastikan PostgreSQL sudah terinstall di sistem Anda. Download dari [postgresql.org](https://www.postgresql.org/download/)

### 2.2 Buat Database

```sql
CREATE DATABASE goldenity_admin;
```

### 2.3 Konfigurasi Environment Variables

Edit file `.env` dan isi dengan kredensial Anda:

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Database Configuration
DATABASE_URL="postgresql://username:password@localhost:5432/goldenity_admin?schema=public"

# Firebase Configuration (Dapatkan dari Firebase Console > Project Settings > Service Accounts)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour Private Key Here\n-----END PRIVATE KEY-----\n"

# CORS Configuration
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

### 2.4 Generate Prisma Client & Migrate Database

```powershell
# Generate Prisma Client
npm run prisma:generate

# Run database migration (membuat tabel di database)
npm run prisma:migrate

# Atau jika ingin membuat migration dengan nama khusus
npx prisma migrate dev --name init

# (Optional) Buka Prisma Studio untuk melihat data
npm run prisma:studio
```

## 🚀 Langkah 3: Menjalankan Server

### Development Mode (dengan auto-reload)
```powershell
npm run dev
```

### Production Mode
```powershell
# Build TypeScript ke JavaScript
npm run build

# Run production server
npm start
```

Server akan berjalan di: **http://localhost:5000**

## 📁 Struktur Folder (3-Tier Architecture)

```
goldenity-admin-core-api/
├── prisma/
│   └── schema.prisma           # Database schema
├── src/
│   ├── config/                 # Configuration files
│   │   ├── database.ts         # Prisma client instance
│   │   └── firebase.ts         # Firebase Admin SDK config
│   ├── controllers/            # Request handlers (Layer 1)
│   │   └── productController.ts
│   ├── services/               # Business logic (Layer 2)
│   │   └── productService.ts
│   ├── routes/                 # API routes
│   │   └── productRoutes.ts
│   ├── middlewares/            # Custom middlewares
│   │   └── authMiddleware.ts   # Firebase auth + tenant extraction
│   ├── types/                  # TypeScript types & interfaces
│   │   └── index.ts
│   ├── utils/                  # Utility functions
│   │   ├── asyncHandler.ts
│   │   └── AppError.ts
│   └── index.ts                # Main server file
├── .env                        # Environment variables
├── .env.example                # Environment template
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## 🔐 Cara Kerja Autentikasi Multi-Tenant

### Flow Autentikasi:

1. **Frontend** (React/Vue/Angular) melakukan login via Firebase Auth
2. Setelah login, Frontend mendapat **Firebase ID Token**
3. Setiap request ke Backend, Frontend mengirim token di header:
   ```
   Authorization: Bearer <firebase-id-token>
   ```
4. **Backend Middleware** (`authMiddleware.ts`) akan:
   - Verifikasi token dengan Firebase Admin SDK
   - Ambil `firebase_uid` dari token
   - Query database untuk mendapatkan `tenantId` user tersebut
   - Attach `tenantId` ke `req.user`
5. **Controller & Service** menggunakan `tenantId` untuk filter data

### Contoh Penggunaan di Route:

```typescript
import { Router } from 'express';
import { authMiddleware, roleMiddleware } from './middlewares/authMiddleware';

const router = Router();

// Protected route - semua authenticated users
router.get('/products', authMiddleware, getProducts);

// Protected route - hanya TENANT_ADMIN dan SUPER_ADMIN
router.post('/products', 
  authMiddleware, 
  roleMiddleware('TENANT_ADMIN', 'SUPER_ADMIN'),
  createProduct
);
```

## 📊 Database Schema Multi-Tenant

### Model Utama:

1. **Tenant** - Data klien/perusahaan
   - `id`, `name`, `slug`, `email`, `isActive`

2. **User** - Data kasir/admin
   - `firebaseUid` (unique, dari Firebase Auth)
   - `tenantId` (FK ke Tenant)
   - `role` (SUPER_ADMIN, TENANT_ADMIN, CASHIER)

3. **Product** - Data barang
   - `tenantId` (FK ke Tenant) - **WAJIB ADA**
   - `sku`, `name`, `price`, `stock`

### Prinsip Multi-Tenant:
✅ **DO**: Setiap model harus memiliki `tenantId` (kecuali Tenant itu sendiri)  
❌ **DON'T**: Jangan pernah query tanpa filter `tenantId` (kecuali SUPER_ADMIN)

## 🧪 Testing API

### Health Check
```bash
curl http://localhost:5000/api/health
```

Response:
```json
{
  "success": true,
  "message": "Goldenity Admin API is running",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "environment": "development"
}
```

### Protected Endpoint (Dengan Token)
```bash
curl -H "Authorization: Bearer <your-firebase-token>" \
     http://localhost:5000/api/products
```

## 🔧 Development Commands

```powershell
# Install dependencies
npm install

# Run development server
npm run dev

# Build TypeScript
npm run build

# Run production
npm start

# Generate Prisma Client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Open Prisma Studio
npm run prisma:studio

# Create new migration
npx prisma migrate dev --name your_migration_name

# Reset database (DANGER!)
npx prisma migrate reset
```

## 🔐 Setup Firebase Admin SDK

1. Buka [Firebase Console](https://console.firebase.google.com/)
2. Pilih project Anda
3. Pergi ke **Project Settings > Service Accounts**
4. Klik **Generate New Private Key**
5. Download file JSON
6. Copy nilai berikut ke `.env`:
   - `project_id` → `FIREBASE_PROJECT_ID`
   - `client_email` → `FIREBASE_CLIENT_EMAIL`
   - `private_key` → `FIREBASE_PRIVATE_KEY` (pastikan escape `\n`)

## 📝 Next Steps

Setelah setup awal selesai, Anda bisa:

1. ✅ Buat seed data untuk testing (tenant & user dummy)
2. ✅ Implementasi CRUD untuk Product
3. ✅ Tambahkan model lain (Category, Transaction, dll.)
4. ✅ Setup validation dengan Zod
5. ✅ Tambahkan logging (Winston/Morgan)
6. ✅ Setup testing (Jest/Supertest)
7. ✅ Deploy ke production (Railway, Render, AWS, dll.)

## 📞 Support

Jika ada pertanyaan atau kendala, silakan hubungi tim development Goldenity.

---

**Built with ❤️ by Goldenity Team**

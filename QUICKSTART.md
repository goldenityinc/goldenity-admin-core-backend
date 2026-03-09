# 🚀 Quick Start Guide - Goldenity Admin Core API

Panduan cepat untuk menjalankan proyek dari awal. Copy-paste perintah berikut secara berurutan.

## ✅ Checklist Persiapan

- [ ] Node.js versi 18+ terinstall
- [ ] PostgreSQL terinstall dan running
- [ ] Firebase project sudah dibuat
- [ ] Firebase Service Account Key sudah di-download

---

## 📝 Step-by-Step Commands

### 1️⃣ Install Dependencies

```powershell
npm install
```

### 2️⃣ Setup Database PostgreSQL

Buat database baru (via psql atau pgAdmin):

```sql
CREATE DATABASE goldenity_admin;
```

### 3️⃣ Konfigurasi Environment Variables

Edit file `.env` dengan kredensial Anda:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/goldenity_admin?schema=public"
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

**Cara mendapatkan Firebase credentials:**
1. Buka [Firebase Console](https://console.firebase.google.com/)
2. Project Settings > Service Accounts
3. Generate New Private Key > Download JSON
4. Copy values dari JSON ke `.env`

### 4️⃣ Generate Prisma Client

```powershell
npm run prisma:generate
```

### 5️⃣ Run Database Migration

```powershell
npm run prisma:migrate
```

Saat diminta nama migration, ketik: `init`

### 6️⃣ (Optional) Seed Database dengan Data Dummy

Buat file `prisma/seed.ts`:

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Buat tenant
  const tenant1 = await prisma.tenant.create({
    data: {
      name: 'Toko Jaya',
      slug: 'toko-jaya',
      email: 'admin@tokojaya.com',
    },
  });

  console.log('✅ Tenant created:', tenant1.name);

  // Buat user admin (gunakan Firebase UID yang sebenarnya)
  const user1 = await prisma.user.create({
    data: {
      firebaseUid: 'FIREBASE_UID_DARI_FIREBASE_AUTH', // Ganti dengan UID asli
      email: 'admin@tokojaya.com',
      name: 'Admin Toko Jaya',
      role: 'TENANT_ADMIN',
      tenantId: tenant1.id,
    },
  });

  console.log('✅ User created:', user1.name);

  // Buat beberapa produk
  await prisma.product.createMany({
    data: [
      {
        sku: 'PROD-001',
        name: 'Indomie Goreng',
        price: 3500,
        stock: 100,
        category: 'Makanan',
        tenantId: tenant1.id,
      },
      {
        sku: 'PROD-002',
        name: 'Aqua 600ml',
        price: 5000,
        stock: 50,
        category: 'Minuman',
        tenantId: tenant1.id,
      },
    ],
  });

  console.log('✅ Products created');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

Tambahkan script di `package.json`:

```json
"scripts": {
  "seed": "ts-node prisma/seed.ts"
}
```

Jalankan seed:

```powershell
npm run seed
```

### 7️⃣ Run Development Server

```powershell
npm run dev
```

Server akan berjalan di: **http://localhost:5000**

### 8️⃣ Test API

Buka browser atau Postman, test endpoint berikut:

**Health Check:**
```
GET http://localhost:5000/api/health
```

Expected response:
```json
{
  "success": true,
  "message": "Goldenity Admin API is running",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "environment": "development"
}
```

---

## 🔍 Troubleshooting

### Error: Cannot connect to database
- Pastikan PostgreSQL service running
- Check kredensial di `DATABASE_URL`
- Test koneksi: `npx prisma db pull`

### Error: Firebase not initialized
- Pastikan `.env` sudah diisi dengan benar
- Check format PRIVATE_KEY (harus ada `\\n`)
- Pastikan Firebase project aktif

### Error: Port already in use
- Ubah `PORT` di `.env` ke port lain (misal: 5001)
- Atau kill process yang menggunakan port 5000

---

## 📚 Useful Commands

```powershell
# View database dengan GUI
npm run prisma:studio

# Reset database (hapus semua data)
npx prisma migrate reset

# Create new migration
npx prisma migrate dev --name migration_name

# Format Prisma schema
npx prisma format

# Check database connection
npx prisma db pull
```

---

## ✅ Setelah Setup Berhasil

Anda siap untuk:
1. ✅ Implementasi CRUD endpoints
2. ✅ Integrate dengan Frontend
3. ✅ Tambahkan fitur-fitur baru
4. ✅ Deploy ke production

Happy coding! 🎉

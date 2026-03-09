# 📂 Struktur Proyek - Goldenity Admin Core API

## Overview Struktur Folder

```
goldenity-admin-core-api/
│
├── 📁 prisma/                      # Prisma ORM Configuration
│   └── schema.prisma               # Database schema (Multi-Tenant)
│
├── 📁 src/                         # Source code
│   │
│   ├── 📁 config/                  # Configuration files
│   │   ├── database.ts             # Prisma Client instance
│   │   └── firebase.ts             # Firebase Admin SDK setup
│   │
│   ├── 📁 controllers/             # LAYER 1: Request Handlers
│   │   └── productController.ts    # Handle HTTP requests/responses
│   │
│   ├── 📁 services/                # LAYER 2: Business Logic
│   │   └── productService.ts       # Database operations & logic
│   │
│   ├── 📁 routes/                  # API Routes Definition
│   │   └── productRoutes.ts        # Product endpoints
│   │
│   ├── 📁 middlewares/             # Custom Middlewares
│   │   └── authMiddleware.ts       # Firebase Auth + Tenant extraction
│   │
│   ├── 📁 types/                   # TypeScript Types & Interfaces
│   │   └── index.ts                # Global type definitions
│   │
│   ├── 📁 utils/                   # Utility Functions
│   │   ├── asyncHandler.ts         # Async error handler wrapper
│   │   └── AppError.ts             # Custom error class
│   │
│   └── index.ts                    # 🚀 Main Server Entry Point
│
├── 📄 .env                         # Environment variables (JANGAN commit!)
├── 📄 .env.example                 # Template environment variables
├── 📄 .gitignore                   # Git ignore rules
├── 📄 nodemon.json                 # Nodemon configuration
├── 📄 package.json                 # NPM dependencies & scripts
├── 📄 tsconfig.json                # TypeScript configuration
├── 📄 README.md                    # Dokumentasi lengkap
├── 📄 QUICKSTART.md                # Panduan cepat eksekusi
└── 📄 STRUCTURE.md                 # File ini (struktur visual)
```

---

## 🏗️ Arsitektur 3-Tier

### **Tier 1: Routes → Controllers**
- **Routes** mendefinisikan endpoint dan apply middleware
- **Controllers** menerima request, call service, return response

### **Tier 2: Services**
- Berisi **business logic**
- Komunikasi dengan database via Prisma
- Validasi data & error handling

### **Tier 3: Database (Prisma ORM)**
- Prisma Client untuk query database
- Type-safe database operations
- Auto-generated types dari schema

---

## 🔄 Request Flow

```
┌─────────────┐
│   CLIENT    │ (Frontend dengan Firebase Auth)
│   (React)   │
└──────┬──────┘
       │ HTTP Request + Firebase Token
       ▼
┌─────────────────────────────────────────────────┐
│              EXPRESS SERVER                     │
│  ┌───────────────────────────────────────────┐ │
│  │  1. MIDDLEWARE LAYER                      │ │
│  │     • CORS                                │ │
│  │     • JSON Parser                         │ │
│  │     • authMiddleware (verify token)      │ │
│  │     • roleMiddleware (check permissions)  │ │
│  │     • tenantMiddleware (validate tenant)  │ │
│  └───────────────┬───────────────────────────┘ │
│                  ▼                              │
│  ┌───────────────────────────────────────────┐ │
│  │  2. ROUTES                                │ │
│  │     • /api/health                         │ │
│  │     • /api/products                       │ │
│  │     • /api/users (future)                 │ │
│  └───────────────┬───────────────────────────┘ │
│                  ▼                              │
│  ┌───────────────────────────────────────────┐ │
│  │  3. CONTROLLERS                           │ │
│  │     • Parse & validate request            │ │
│  │     • Call service layer                  │ │
│  │     • Format response                     │ │
│  └───────────────┬───────────────────────────┘ │
│                  ▼                              │
│  ┌───────────────────────────────────────────┐ │
│  │  4. SERVICES (Business Logic)            │ │
│  │     • Process data                        │ │
│  │     • Apply business rules                │ │
│  │     • Filter by tenantId                  │ │
│  └───────────────┬───────────────────────────┘ │
│                  ▼                              │
│  ┌───────────────────────────────────────────┐ │
│  │  5. DATABASE (Prisma ORM)                 │ │
│  │     • Execute SQL queries                 │ │
│  │     • Return data                         │ │
│  └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
       │
       ▼
┌──────────────┐
│  PostgreSQL  │
│   Database   │
└──────────────┘
```

---

## 🔐 Multi-Tenant Architecture

### Prinsip Dasar:
1. **Setiap data harus memiliki `tenantId`**
2. **Semua query harus filter by `tenantId`** (kecuali SUPER_ADMIN)
3. **Middleware otomatis inject `tenantId` dari user login**

### Data Flow Multi-Tenant:

```
User Login (Firebase)
    ↓
Firebase ID Token
    ↓
authMiddleware verifikasi token
    ↓
Query User dari database → Dapat tenantId
    ↓
Attach tenantId ke req.user
    ↓
Controller & Service filter by tenantId
    ↓
Return data hanya untuk tenant user tersebut
```

### Contoh Query dengan Tenant Isolation:

```typescript
// ❌ SALAH - Tidak filter by tenant (data bocor!)
const products = await prisma.product.findMany();

// ✅ BENAR - Filter by tenantId
const products = await prisma.product.findMany({
  where: { tenantId: req.user.tenantId }
});
```

---

## 📊 Database Models

### **Tenant** (Tabel Master Klien)
```
┌──────────────────────────┐
│       TENANT             │
├──────────────────────────┤
│ id: UUID (PK)            │
│ name: String             │
│ slug: String (UNIQUE)    │
│ email: String            │
│ isActive: Boolean        │
└──────────────────────────┘
         │
         │ 1:N
         ▼
┌──────────────────────────┐
│        USER              │
├──────────────────────────┤
│ id: UUID (PK)            │
│ firebaseUid: String      │
│ email: String            │
│ tenantId: UUID (FK) ───► │ Link ke Tenant
│ role: UserRole           │
│ isActive: Boolean        │
└──────────────────────────┘

┌──────────────────────────┐
│       PRODUCT            │
├──────────────────────────┤
│ id: UUID (PK)            │
│ sku: String              │
│ name: String             │
│ price: Decimal           │
│ tenantId: UUID (FK) ───► │ Link ke Tenant
│ isActive: Boolean        │
└──────────────────────────┘
```

---

## 🛡️ Security Layers

1. **Firebase Authentication** - User login via Firebase
2. **Token Verification** - Backend verify Firebase ID Token
3. **Tenant Isolation** - Automatic filter by tenantId
4. **Role-Based Access** - SUPER_ADMIN, TENANT_ADMIN, CASHIER
5. **CORS Protection** - Only allow specific origins

---

## 📝 File Descriptions

### **Core Files:**

- **`src/index.ts`**  
  Entry point aplikasi. Setup Express, middleware, routes, error handling.

- **`src/config/database.ts`**  
  Prisma Client instance. Digunakan di semua service untuk query database.

- **`src/config/firebase.ts`**  
  Firebase Admin SDK setup. Digunakan untuk verifikasi token.

### **Middleware:**

- **`src/middlewares/authMiddleware.ts`**  
  Verifikasi Firebase token, ekstrak user info, inject tenantId ke request.

### **Controllers:**

- **`src/controllers/productController.ts`**  
  Handle request/response untuk Product endpoints.

### **Services:**

- **`src/services/productService.ts`**  
  Business logic untuk Product. Query database dengan filter tenantId.

### **Routes:**

- **`src/routes/productRoutes.ts`**  
  Definisi endpoint API untuk Product dengan middleware.

### **Utils:**

- **`src/utils/asyncHandler.ts`**  
  Wrapper untuk handle async errors di controller.

- **`src/utils/AppError.ts`**  
  Custom error class dengan statusCode.

### **Types:**

- **`src/types/index.ts`**  
  TypeScript type definitions untuk Request, Response, etc.

---

## 🎯 Next Steps

Setelah struktur dasar ini, Anda bisa extend dengan:

1. **Tambah Model Baru** (Category, Transaction, etc.)
2. **Implement Full CRUD** untuk setiap resource
3. **Add Validation** dengan Zod schemas
4. **Add Logging** dengan Winston/Morgan
5. **Add Testing** dengan Jest/Supertest
6. **Setup CI/CD** untuk auto deployment
7. **Add Documentation** dengan Swagger/OpenAPI

---

**Happy Coding!** 🚀

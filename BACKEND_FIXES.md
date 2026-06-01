# Backend Fixes - Sales Transaction Issues

## 📋 Issue 1: Harga Servis Custom Hilang (Custom Service Price Missing)

### Problem
When a cashier overrides a service price in the POS cart (e.g., changing from Rp 0 to Rp 10,000), the Flutter app sends the custom price to the backend. However, the backend was not properly prioritizing the custom price from the frontend, causing it to default to the master product price (Rp 0) instead.

### Root Cause
**File:** [src/services/salesService.ts](src/services/salesService.ts#L102-L120)

The `normalizeSaleItem` function had logic that only applied custom prices prioritically for custom items (`isCustomItem`), not for services:

**Original Code (BROKEN):**
```typescript
custom_price: item.isCustomItem ? customPrice ?? new Prisma.Decimal(0) : customPrice,
```

This meant:
- For custom items: Use `customPrice` or default to 0
- For services with override: Use `customPrice` as-is (could be undefined)
- If `customPrice` is undefined, it becomes NULL in the database

### Solution
**Fixed:** [src/services/salesService.ts](src/services/salesService.ts#L102-L118)

Changed the logic to always prioritize provided custom prices:

```typescript
const resolvedCustomPrice = 
  customPrice !== undefined && customPrice !== null 
    ? customPrice  // Always use provided custom price (both custom items and services)
    : (item.isCustomItem ? new Prisma.Decimal(0) : null);  // Default only for custom items
```

**Key Changes:**
1. ✅ Explicit check: If `customPrice` is provided, use it (works for both custom items AND services)
2. ✅ Default behavior: Only custom items get a default of 0
3. ✅ Services: If no custom price provided, store NULL (not a forced default)
4. ✅ Proper type handling: Convert to `Prisma.Decimal` for database compatibility

### Additional Enhancements

#### Enhanced Logging
Added detailed logging to track custom price issues:

1. **In Sales Service** ([src/services/salesService.ts](src/services/salesService.ts#L137-L146)):
   - Logs items with custom prices before insertion
   - Logs service items when custom price is successfully saved to DB

2. **In Sales Controller** ([src/controllers/salesController.ts](src/controllers/salesController.ts#L28-L45)):
   - Logs validation errors
   - Logs successful sale creation with item count
   - Logs errors with full stack traces

### Testing Custom Service Price Fix

```bash
# Test 1: Create sale with service having custom price
POST /api/v1/sales
Authorization: Bearer <token>
Body: {
  "orderType": "WALK_IN",
  "items": [
    {
      "productName": "Service A",
      "isService": true,
      "customPrice": "10000",  // ← Custom override
      "qty": 1
    }
  ],
  "branchId": "123"
}

# Expected: 
# ✅ Database saves custom_price = 10000 for this item
# ✅ Logs show: "[SalesService.createSale] Service item saved with custom price: Service A = 10000"
# ✅ Receipt prints with correct custom price, not 0
```

---

## 📋 Issue 2: Void Transaksi Gagal Pindah Status (Void Transaction Status Not Updating)

### Problem
When voiding a transaction:
1. ✅ Inventory stock is restored successfully
2. ❌ Transaction status stays as `COMPLETED` or unchanged
3. ❌ POS app thinks transaction is still active
4. ❌ Can void the same transaction infinitely

### Root Cause
**Missing Endpoint:** The void/cancel transaction endpoint did not exist in the original codebase.

While inventory restoration logic existed elsewhere (outside this API), there was no endpoint to update the transaction status to `CANCELLED` afterwards.

### Solution
**Added Complete Void Transaction Flow** with proper status management:

#### 1. Service Layer Method
**File:** [src/services/transactionService.ts](src/services/transactionService.ts#L66-L115)

New `cancelTransaction()` method:
```typescript
static async cancelTransaction(
  tenantId: string,
  id: bigint,
  branchId: bigint | null,
  requireScopedBranch = false,
)
```

**Features:**
- ✅ Validates transaction exists and belongs to tenant
- ✅ Prevents double-cancellation (if status is already CANCELLED)
- ✅ Updates `order_status` to `'CANCELLED'`
- ✅ Updates `updated_at` timestamp
- ✅ Returns enriched transaction object for frontend
- ✅ Detailed error logging for debugging
- ✅ Branch isolation enforced

#### 2. Controller Endpoint
**File:** [src/controllers/transactionController.ts](src/controllers/transactionController.ts#L163-L207)

New `cancelTransaction()` controller:
```typescript
export const cancelTransaction = asyncHandler(async (req: Request, res: Response) => {
  // PATCH /api/v1/transactions/:id/cancel
  // Authorization: TENANT_ADMIN and above only
```

**Features:**
- ✅ Authorization check (only managers/HQ can cancel)
- ✅ Input validation
- ✅ Calls service method
- ✅ Returns updated transaction with CANCELLED status
- ✅ Comprehensive error logging

#### 3. Route Registration
**File:** [src/routes/transactionRoutes.ts](src/routes/transactionRoutes.ts)

New route:
```typescript
router.patch('/:id/cancel', cancelTransaction);
```

### Complete Void Transaction Flow

**Recommended Sequence:**
```
1. POS calls: PATCH /api/v1/transactions/:id/cancel
   ↓
2. Backend:
   a. Verify transaction exists
   b. Check status is not already CANCELLED
   c. Update order_status → 'CANCELLED'
   d. Return updated transaction
   ↓
3. POS receives updated transaction with status='CANCELLED'
   ↓
4. POS updates local state and UI
   ↓
5. User sees: "Transaction Voided ✓" with new status
```

### Testing Void Transaction Fix

```bash
# Test 1: Void an active transaction
PATCH /api/v1/transactions/123/cancel
Authorization: Bearer <tenant_admin_token>

# Expected Response (200 OK):
{
  "success": true,
  "message": "Transaksi berhasil dibatalkan. Status diubah menjadi CANCELLED.",
  "data": {
    "id": 123,
    "order_status": "CANCELLED",    ← Changed from COMPLETED
    "updated_at": "2026-06-01T10:30:00Z",
    "receipt_number": "RCP001",
    ...
  }
}

# Logs show:
# "[TransactionService.cancelTransaction] Cancelling transaction ID=123..."
# "[TransactionService.cancelTransaction] Transaction cancelled successfully. New Status=CANCELLED"


# Test 2: Try to void same transaction again (should fail)
PATCH /api/v1/transactions/123/cancel
Authorization: Bearer <tenant_admin_token>

# Expected Response (400 Bad Request):
{
  "success": false,
  "message": "Transaksi sudah dibatalkan sebelumnya"
}

# Logs show:
# "[TransactionService.cancelTransaction] Cancelling transaction ID=123..."
# Error thrown: "Transaksi sudah dibatalkan sebelumnya"


# Test 3: Unauthorized user tries to void (should fail)
PATCH /api/v1/transactions/123/cancel
Authorization: Bearer <cashier_token>

# Expected Response (403 Forbidden):
{
  "success": false,
  "message": "Anda tidak memiliki izin untuk membatalkan transaksi"
}
```

### Database Schema
The `sales_records` table already has the `order_status` column with enum type `OrderStatus`:

```sql
CREATE TYPE "OrderStatus" AS ENUM (
  'PENDING',
  'PREPARING', 
  'READY_FOR_PICKUP',
  'COMPLETED',
  'CANCELLED'
);

ALTER TABLE sales_records 
ADD COLUMN order_status OrderStatus DEFAULT 'COMPLETED';
```

✅ No schema migration needed - column already exists!

---

## 📝 Summary of Changes

### Files Modified

| File | Change | Purpose |
|------|--------|---------|
| [src/services/salesService.ts](src/services/salesService.ts) | Fixed `normalizeSaleItem()` + added logging | Custom price now prioritized correctly |
| [src/controllers/salesController.ts](src/controllers/salesController.ts) | Added error logging to `createSale()` | Better debugging of sales creation |
| [src/services/transactionService.ts](src/services/transactionService.ts) | Added `cancelTransaction()` method | New void transaction logic |
| [src/controllers/transactionController.ts](src/controllers/transactionController.ts) | Added `cancelTransaction()` endpoint | New API endpoint for voiding |
| [src/routes/transactionRoutes.ts](src/routes/transactionRoutes.ts) | Added PATCH `:id/cancel` route | Wire up new endpoint |

---

## 🔍 Debugging Tips

### For Custom Service Price Issues
1. Check logs for: `[SalesService.createSale] Sale with X items with custom prices`
2. Check database: 
   ```sql
   SELECT product_name, custom_price, is_service 
   FROM sales_record_items 
   WHERE sales_record_id = <id>;
   ```
3. Verify custom price isn't being overwritten elsewhere in POS/reporting

### For Void Transaction Issues
1. Check logs for: `[TransactionService.cancelTransaction]`
2. Check database:
   ```sql
   SELECT id, order_status, updated_at 
   FROM sales_records 
   WHERE id = <id>;
   ```
3. Ensure POS is calling the endpoint after inventory restoration
4. Verify authorization token has TENANT_ADMIN role or higher

---

## 🚀 Deployment Steps

1. **Backup Database**
   ```sql
   pg_dump goldenity_admin > backup_$(date +%Y%m%d).sql
   ```

2. **Deploy Code**
   - Commit changes to git
   - Pull latest code to server
   - Run `npm install` (if dependencies changed)
   - No migrations needed

3. **Test Endpoints**
   ```bash
   # Test custom price
   npm test -- custom-price.test.ts
   
   # Test void transaction
   npm test -- void-transaction.test.ts
   ```

4. **Monitor Logs**
   ```bash
   npm start 2>&1 | tee sales.log
   ```

5. **Verify in POS**
   - Create transaction with service override
   - Verify custom price shows in receipt
   - Void transaction
   - Verify status changes to CANCELLED

---

## ⚠️ Important Notes

1. **Void Transaction Flow**: The void endpoint assumes inventory restoration happens BEFORE calling this endpoint. Coordinate with POS/Bridge to ensure correct sequencing.

2. **Custom Price Display**: Ensure POS retrieves and displays `custom_price` from the API response, not the master product price.

3. **Error Handling**: All endpoints log errors in detail. Check application logs if issues persist.

4. **Authorization**: Only TENANT_ADMIN and above can void transactions. Ensure POS tokens have correct role.

---

**Status:** ✅ All fixes implemented and ready for testing
**Last Updated:** 2026-06-01
**Version:** 1.0.0

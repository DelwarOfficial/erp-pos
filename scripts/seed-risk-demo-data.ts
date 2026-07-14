// scripts/seed-risk-demo-data.ts
// Seeds the admin's company with the minimum data needed to post a sale:
//   - 1 branch
//   - 1 warehouse (linked to branch)
//   - 2 products (with stock)
//   - 1 customer (active)
//
// Idempotent — safe to run multiple times.

import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const ADMIN_COMPANY_ID = 'af3641f2-946b-47a2-a78a-4e8e65f4c4b5';
const ADMIN_USER_ID = (await db.user.findFirst({ where: { email: 'admin@erp-platform.local' }, select: { id: true } }))?.id;
if (!ADMIN_USER_ID) throw new Error('Admin user not found');

console.log('Seeding demo data for admin company:', ADMIN_COMPANY_ID);

// 1. Branch (idempotent)
let branch = await db.branch.findFirst({ where: { companyId: ADMIN_COMPANY_ID } });
if (!branch) {
  branch = await db.branch.create({
    data: {
      companyId: ADMIN_COMPANY_ID,
      name: 'Demo Branch',
      code: 'DEMO',
      address: '123 Gulshan Avenue, Dhaka',
      phone: '+8801712345678',
      isActive: true,
    },
  });
  console.log('  ✓ Created branch:', branch.id);
} else {
  console.log('  ✓ Branch already exists:', branch.id);
}

// 2. Warehouse (idempotent)
let warehouse = await db.warehouse.findFirst({ where: { companyId: ADMIN_COMPANY_ID } });
if (!warehouse) {
  warehouse = await db.warehouse.create({
    data: {
      companyId: ADMIN_COMPANY_ID,
      branchId: branch.id,
      name: 'Demo Warehouse',
      code: 'DEMO-WH',
      isActive: true,
    },
  });
  console.log('  ✓ Created warehouse:', warehouse.id);
} else {
  console.log('  ✓ Warehouse already exists:', warehouse.id);
}

// 3. Currency (BDT should already exist — create if missing)
const currency = await db.currency.upsert({
  where: { code: 'BDT' },
  update: {},
  create: { code: 'BDT', name: 'Bangladeshi Taka', decimalPlaces: 2, isActive: true },
});
console.log('  ✓ Currency:', currency.code);

// 4. Category (idempotent)
let category = await db.category.findFirst({ where: { companyId: ADMIN_COMPANY_ID } });
if (!category) {
  category = await db.category.create({
    data: {
      companyId: ADMIN_COMPANY_ID,
      name: 'Electronics',
      code: 'ELEC',
      isActive: true,
    },
  });
  console.log('  ✓ Created category:', category.id);
} else {
  console.log('  ✓ Category already exists:', category.id);
}

// 5. Brand (idempotent)
let brand = await db.brand.findFirst({ where: { companyId: ADMIN_COMPANY_ID } });
if (!brand) {
  brand = await db.brand.create({
    data: {
      companyId: ADMIN_COMPANY_ID,
      name: 'DemoBrand',
      isActive: true,
    },
  });
  console.log('  ✓ Created brand:', brand.id);
} else {
  console.log('  ✓ Brand already exists:', brand.id);
}

// 6. Unit (idempotent) — 'pcs'
let unit = await db.unit.findFirst({ where: { companyId: ADMIN_COMPANY_ID } });
if (!unit) {
  unit = await db.unit.create({
    data: {
      companyId: ADMIN_COMPANY_ID,
      name: 'Piece',
      code: 'PCS',
      baseFactor: 1,
      isActive: true,
    },
  });
  console.log('  ✓ Created unit:', unit.id);
} else {
  console.log('  ✓ Unit already exists:', unit.id);
}

// 7. Products (idempotent)
const productData = [
  { name: 'Demo Phone X1', code: 'DP-X1', cost: 8000, price: 12000 },
  { name: 'Demo Phone X2', code: 'DP-X2', cost: 15000, price: 22000 },
  { name: 'Demo Charger', code: 'DC-1', cost: 200, price: 500 },
];
const products = [];
for (const pd of productData) {
  let p = await db.product.findFirst({ where: { companyId: ADMIN_COMPANY_ID, code: pd.code } });
  if (!p) {
    p = await db.product.create({
      data: {
        companyId: ADMIN_COMPANY_ID,
        categoryId: category.id,
        brandId: brand.id,
        unitId: unit.id,
        name: pd.name,
        code: pd.code,
        productType: 'standard',
        isActive: true,
        isSerialized: false,
        referenceCost: pd.cost,
        defaultPrice: pd.price,
      },
    });
    console.log('  ✓ Created product:', p.code, p.id);

    // Add stock (warehouse_stocks)
    try {
      await db.warehouseStock.create({
        data: {
          companyId: ADMIN_COMPANY_ID,
          warehouseId: warehouse.id,
          productId: p.id,
          qtyOnHand: 100,
          qtyReserved: 0,
          movingAverageCost: pd.cost,
          version: 1,
        },
      });
    } catch (e) {
      console.log('    (warehouseStock create skipped:', e instanceof Error ? e.message.slice(0, 80) : e, ')');
    }
  } else {
    console.log('  ✓ Product already exists:', p.code);
  }
  products.push(p);
}

// 8. Customer (idempotent)
let customer = await db.customer.findFirst({ where: { companyId: ADMIN_COMPANY_ID } });
if (!customer) {
  customer = await db.customer.create({
    data: {
      companyId: ADMIN_COMPANY_ID,
      name: 'Demo Customer',
      phone: '+8801712345678',
      email: 'demo@example.com',
      address: 'House 5, Road 10, Banani, Dhaka',
      isActive: true,
    },
  });
  console.log('  ✓ Created customer:', customer.id);
} else {
  console.log('  ✓ Customer already exists:', customer.id);
}

// 9. Confirm financial accounts (already exist)
const faCount = await db.financialAccount.count({ where: { companyId: ADMIN_COMPANY_ID } });
console.log('  ✓ Financial accounts available:', faCount);

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('Demo data ready. Use these IDs for sale:');
console.log('  Company:', ADMIN_COMPANY_ID);
console.log('  Branch:', branch.id);
console.log('  Warehouse:', warehouse.id);
console.log('  Customer:', customer.id);
console.log('  Products:', products.map(p => `${p.code}=${p.id}`).join(', '));
console.log('═══════════════════════════════════════════════════════════');

await db.$disconnect();

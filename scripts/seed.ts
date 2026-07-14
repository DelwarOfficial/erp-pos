// scripts/seed.ts
// Seed base currency, permissions catalogue, system roles, and the first
// platform_operations admin user. Run after the first migration push.

import { db } from '../src/lib/db';
import { seedPermissions, SYSTEM_ROLES, PERMISSIONS } from '../src/lib/permissions/catalogue';
import { hashPassword } from '../src/lib/auth/password';

async function main() {
  console.log('→ Seeding currencies...');
  await db.currency.upsert({
    where: { code: 'BDT' },
    create: { code: 'BDT', name: 'Bangladeshi Taka', decimalPlaces: 2, isActive: true },
    update: { name: 'Bangladeshi Taka', decimalPlaces: 2, isActive: true },
  });
  await db.currency.upsert({
    where: { code: 'USD' },
    create: { code: 'USD', name: 'US Dollar', decimalPlaces: 2, isActive: true },
    update: {},
  });
  await db.currency.upsert({
    where: { code: 'EUR' },
    create: { code: 'EUR', name: 'Euro', decimalPlaces: 2, isActive: true },
    update: {},
  });

  console.log('→ Seeding permissions catalogue...');
  const permCount = await seedPermissions();
  console.log(`  ✓ ${permCount} permissions upserted`);

  console.log('→ Seeding platform company (placeholder for sandbox)...');
  // Create a sandbox platform company that owns platform_operations users.
  // Real tenants are created via the onboarding API (§20.D01).
  const platformCompany = await db.company.upsert({
    where: { code: 'PLATFORM' },
    create: {
      code: 'PLATFORM',
      legalName: 'ERP Platform Operations',
      displayName: 'Platform Operations',
      baseCurrencyCode: 'BDT',
      timezone: 'Asia/Dhaka',
      countryCode: 'BD',
      status: 'active',
      defaultLocale: 'en-BD',
    },
    update: {},
  });

  console.log('→ Seeding system roles...');
  for (const spec of SYSTEM_ROLES) {
    const role = await db.role.upsert({
      where: { companyId_name: { companyId: platformCompany.id, name: spec.name } },
      create: {
        companyId: platformCompany.id,
        name: spec.name,
        description: spec.description,
        isSystemRole: true,
      },
      update: { description: spec.description },
    });

    // Attach permissions (expand wildcards)
    const perms = spec.permissions.includes('*')
      ? PERMISSIONS
      : spec.permissions.flatMap(p =>
          p.endsWith('.*')
            ? PERMISSIONS.filter(x => x.code.startsWith(p.slice(0, -1)))
            : PERMISSIONS.filter(x => x.code === p),
        );

    for (const p of perms) {
      const perm = await db.permission.findUnique({ where: { code: p.code } });
      if (!perm) continue;
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        create: { roleId: role.id, permissionId: perm.id },
        update: {},
      });
    }
    console.log(`  ✓ role "${spec.name}" with ${perms.length} permissions`);
  }

  console.log('→ Seeding first platform_operations admin...');
  const adminEmail = 'admin@erp-platform.local';
  const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD ?? 'ChangeMe!2026';
  const platformRole = await db.role.findFirst({
    where: { companyId: platformCompany.id, name: 'platform_operations' },
  });
  if (!platformRole) throw new Error('platform_operations role not seeded');

  const existing = await db.user.findFirst({
    where: { companyId: platformCompany.id, email: adminEmail },
  });
  if (!existing) {
    const hash = await hashPassword(adminPassword);
    const admin = await db.user.create({
      data: {
        companyId: platformCompany.id,
        name: 'Platform Admin',
        email: adminEmail,
        passwordHash: hash,
        accessScope: 'global',
        isActive: true,
      },
    });
    await db.userRole.create({
      data: { userId: admin.id, roleId: platformRole.id },
    });
    console.log(`  ✓ admin user created: ${adminEmail} / ${adminPassword}`);
  } else {
    console.log(`  ✓ admin user already exists: ${adminEmail}`);
  }

  console.log('\n✓ Seed complete.');
}

main()
  .catch((e) => {
    console.error('✗ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });

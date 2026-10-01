// GET  /api/v1/employees  — list employees
// POST /api/v1/employees  — create employee

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';

import { EmployeeInput, employeeFields, validateEmployeeReferences } from '@/lib/api/employeeInput';
import { readListPage, listPageArgs, listPageResult } from '@/lib/api/listPage';

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, "employee.read");
    const page = readListPage(req.nextUrl);
    const search = req.nextUrl.searchParams.get('search')?.trim();
    const employees = await runInTenantContext(auth.ctx, async () => {
      return db.employee.findMany({
        where: { companyId: auth.companyId },
        take: 100, orderBy: { name: 'asc' },
        select: {
          id: true,
          employeeNo: true,
          name: true,
          phone: true,
          email: true,
          employmentStatus: true,
          baseSalary: true,
          joinDate: true,
          branch: { select: { id: true, name: true, code: true } },
          department: { select: { id: true, name: true } },
          designation: { select: { id: true, name: true } },
        },
      });
    });
    return NextResponse.json({
      ...listPageResult(employees, page),
      items: listPageResult(employees, page).items.map(e => ({
        id: e.id, employee_no: e.employeeNo, name: e.name,
        phone: e.phone, email: e.email,
        branch: e.branch, department: e.department, designation: e.designation,
        employment_status: e.employmentStatus,
        base_salary: e.baseSalary.toString(),
        join_date: e.joinDate,
      })),
    });
  } catch (e) { return errorResponse(e, correlationId); }
}

export async function POST(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
    await requirePermission(auth, "employee.manage.branch");
    const idempotencyKey = requireIdempotencyKey(req);
    const body = EmployeeInput.parse(await req.json());
    await requirePermission(auth, 'employee.manage.branch', body.branch_id);
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/employees', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withTenant(auth.ctx, async (tx) =>
        withIdempotency(
          { idempotencyKey, operation: 'employee.create', requestHash, companyId: auth.companyId, userId: auth.userId },
          async () => {
            await validateEmployeeReferences(tx, auth.companyId, body);
            const emp = await tx.employee.create({
              data: {
                companyId: auth.companyId,
                ...employeeFields(body),
              },
            });
            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'employee.create', entityType: 'employee', entityId: emp.id,
                afterValue: JSON.stringify({ name: emp.name, employee_no: emp.employeeNo }) },
            });
            return { status: 201, body: { id: emp.id, name: emp.name }, resourceType: 'employee', resourceId: emp.id };
          },
          tx,
        )),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid employee payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}

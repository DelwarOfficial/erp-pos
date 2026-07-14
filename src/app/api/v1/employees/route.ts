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

const EmployeeSchema = z.object({
  employee_no: z.string().min(1).max(40),
  branch_id: z.string().uuid(),
  department_id: z.string().uuid().optional(),
  designation_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  name: z.string().min(1).max(150),
  phone: z.string().max(30).optional(),
  email: z.string().email().max(150).optional(),
  address: z.string().optional(),
  join_date: z.string().datetime(),
  base_salary: z.number().min(0).default(0),
  payroll_expense_account_id: z.string().uuid(),
  payroll_payable_account_id: z.string().uuid(),
});

export async function GET(req: NextRequest) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest();
  await requirePermission(auth, 'user.create');
  await requirePermission(auth, 'user.read');
    const employees = await db.employee.findMany({
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
    return NextResponse.json({
      items: employees.map(e => ({
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
    const idempotencyKey = requireIdempotencyKey(req);
    const body = EmployeeSchema.parse(await req.json());
    const requestHash = computeRequestHash({ method: 'POST', path: '/api/v1/employees', body });

    const result = await runInTenantContext(auth.ctx, () =>
      withIdempotency(
        { idempotencyKey, operation: 'employee.create', requestHash, companyId: auth.companyId, userId: auth.userId },
        async () => {
          return withTenant(auth.ctx, async (tx) => {
            const emp = await tx.employee.create({
              data: {
                companyId: auth.companyId,
                employeeNo: body.employee_no,
                branchId: body.branch_id,
                departmentId: body.department_id ?? null,
                designationId: body.designation_id ?? null,
                userId: body.user_id ?? null,
                name: body.name,
                phone: body.phone ?? null,
                email: body.email ?? null,
                address: body.address ?? null,
                joinDate: new Date(body.join_date),
                baseSalary: body.base_salary,
                payrollExpenseAccountId: body.payroll_expense_account_id,
                payrollPayableAccountId: body.payroll_payable_account_id,
              },
            });
            await tx.auditLog.create({
              data: { companyId: auth.companyId, userId: auth.userId, correlationId,
                action: 'employee.create', entityType: 'employee', entityId: emp.id,
                afterValue: JSON.stringify({ name: emp.name, employee_no: emp.employeeNo }) },
            });
            return { status: 201, body: { id: emp.id, name: emp.name }, resourceType: 'employee', resourceId: emp.id };
          });
        },
      ),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid employee payload', { issues: e.issues }, 400), correlationId);
    return errorResponse(e, correlationId);
  }
}

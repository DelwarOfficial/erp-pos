import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticateRequest, requirePermission } from '@/lib/auth/middleware';
import { runInTenantContext, withTenant } from '@/lib/db/transaction';
import { withIdempotency, computeRequestHash, requireIdempotencyKey } from '@/lib/idempotency';
import { DomainError, errorResponse } from '@/lib/errors/codes';
import { getCorrelationId } from '@/lib/http';
import { EmployeeInput, employeeFields, validateEmployeeReferences } from '@/lib/api/employeeInput';

type Context = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, { params }: Context) {
  try {
    const auth = await authenticateRequest(); await requirePermission(auth, 'employee.read'); const { id } = await params;
    const data = await runInTenantContext(auth.ctx, async () => {
      const employee = await db.employee.findFirst({ where: { id, companyId: auth.companyId }, select: {
        id: true, employeeNo: true, name: true, phone: true, email: true, address: true, joinDate: true, employmentStatus: true, baseSalary: true,
        payrollExpenseAccountId: true, payrollPayableAccountId: true,
        branch: { select: { id: true, name: true, code: true } }, department: { select: { id: true, name: true } }, designation: { select: { id: true, name: true } }, user: { select: { id: true, name: true } },
      } });
      if (!employee) throw new DomainError('RESOURCE_NOT_FOUND', 'Employee not found', {}, 404);
      const accounts = await db.chartOfAccount.findMany({ where: { companyId: auth.companyId, id: { in: [employee.payrollExpenseAccountId, employee.payrollPayableAccountId] } }, select: { id: true, name: true, code: true } });
      return { ...employee, expenseAccount: accounts.find(account => account.id === employee.payrollExpenseAccountId) ?? null, payableAccount: accounts.find(account => account.id === employee.payrollPayableAccountId) ?? null };
    });
    return NextResponse.json(data);
  } catch (error) { return errorResponse(error, getCorrelationId(req)); }
}
export async function POST(req: NextRequest, { params }: Context) {
  const correlationId = getCorrelationId(req);
  try {
    const auth = await authenticateRequest(); await requirePermission(auth, 'employee.manage.branch'); const { id } = await params;
    const body = EmployeeInput.parse(await req.json()); await requirePermission(auth, 'employee.manage.branch', body.branch_id);
    const key = requireIdempotencyKey(req);
    const result = await runInTenantContext(auth.ctx, () => withTenant(auth.ctx, tx => withIdempotency({ companyId: auth.companyId, userId: auth.userId, idempotencyKey: key, operation: 'employee.update', requestHash: computeRequestHash({ method: 'POST', path: '/api/v1/employees/' + id, body }) }, async () => {
      const before = await tx.employee.findFirst({ where: { id, companyId: auth.companyId } });
      if (!before) throw new DomainError('RESOURCE_NOT_FOUND', 'Employee not found', {}, 404);
      await validateEmployeeReferences(tx, auth.companyId, body, id);
      await tx.employee.update({ where: { id }, data: employeeFields(body) });
      await tx.auditLog.create({ data: { companyId: auth.companyId, userId: auth.userId, correlationId, action: 'employee.update', entityType: 'employee', entityId: id,
        beforeValue: JSON.stringify({ employee_no: before.employeeNo, name: before.name, branch_id: before.branchId, base_salary: before.baseSalary.toString(), payroll_expense_account_id: before.payrollExpenseAccountId, payroll_payable_account_id: before.payrollPayableAccountId }),
        afterValue: JSON.stringify({ employee_no: body.employee_no, name: body.name, branch_id: body.branch_id, base_salary: body.base_salary, payroll_expense_account_id: body.payroll_expense_account_id, payroll_payable_account_id: body.payroll_payable_account_id }) } });
      return { status: 200, body: { id, name: body.name }, resourceType: 'employee', resourceId: id };
    }, tx)));
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(new DomainError('VALIDATION_FAILED', 'Invalid employee details', { issues: error.issues }, 400), correlationId);
    return errorResponse(error, correlationId);
  }
}

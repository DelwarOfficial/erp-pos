import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { DomainError } from '@/lib/errors/codes';

export const EmployeeInput = z.object({
  employee_no: z.string().trim().min(1).max(40), branch_id: z.string().uuid(),
  department_id: z.string().uuid().nullable().optional(), designation_id: z.string().uuid().nullable().optional(),
  user_id: z.string().uuid().nullable().optional(), name: z.string().trim().min(1).max(150),
  phone: z.string().trim().max(30).optional(), email: z.union([z.string().email().max(150), z.literal('')]).optional(),
  address: z.string().max(2000).optional(), join_date: z.string().datetime(),
  base_salary: z.number().finite().min(0).default(0), payroll_expense_account_id: z.string().uuid(), payroll_payable_account_id: z.string().uuid(),
});

export async function validateEmployeeReferences(tx: Prisma.TransactionClient, companyId: string, body: z.infer<typeof EmployeeInput>, id?: string) {
  if (!await tx.branch.findFirst({ where: { companyId, id: body.branch_id, isActive: true } })) throw new DomainError('VALIDATION_FAILED', 'Select an active branch from this company', {}, 400);
  if (body.department_id && !await tx.department.findFirst({ where: { companyId, id: body.department_id, isActive: true } })) throw new DomainError('VALIDATION_FAILED', 'Select an active department from this company', {}, 400);
  if (body.designation_id && !await tx.designation.findFirst({ where: { companyId, id: body.designation_id, isActive: true } })) throw new DomainError('VALIDATION_FAILED', 'Select an active designation from this company', {}, 400);
  if (body.user_id && !await tx.user.findFirst({ where: { companyId, id: body.user_id, isActive: true, deletedAt: null } })) throw new DomainError('VALIDATION_FAILED', 'Select an active user from this company', {}, 400);
  if (await tx.employee.findFirst({ where: { companyId, ...(id ? { id: { not: id } } : {}), OR: [{ employeeNo: body.employee_no }, ...(body.user_id ? [{ userId: body.user_id }] : [])] } })) throw new DomainError('VALIDATION_FAILED', 'Employee number or linked user already belongs to another employee', {}, 409);
  for (const [accountId, accountClass] of [[body.payroll_expense_account_id, 'expense'], [body.payroll_payable_account_id, 'liability']]) {
    if (!await tx.chartOfAccount.findFirst({ where: { companyId, id: accountId, accountClass, isActive: true } })) throw new DomainError('VALIDATION_FAILED', `Select an active ${accountClass} account from this company for payroll`, {}, 400);
  }
}

export function employeeFields(body: z.infer<typeof EmployeeInput>) {
  return { employeeNo: body.employee_no, branchId: body.branch_id, departmentId: body.department_id,
    designationId: body.designation_id, userId: body.user_id, name: body.name, phone: body.phone || null,
    email: body.email || null, address: body.address || null, joinDate: new Date(body.join_date), baseSalary: body.base_salary,
    payrollExpenseAccountId: body.payroll_expense_account_id, payrollPayableAccountId: body.payroll_payable_account_id };
}

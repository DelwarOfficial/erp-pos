import { z } from 'zod';

/** The existing customer-create contract, shared with inline customer forms. */
export const CustomerSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().max(30).optional(),
  email: z.string().email().max(150).optional(),
  address: z.string().optional(),
  tax_identifier: z.string().max(50).optional(),
  customer_group_id: z.string().uuid().optional(),
  credit_limit: z.number().min(0).default(0),
  preferred_branch_id: z.string().uuid().optional(),
});

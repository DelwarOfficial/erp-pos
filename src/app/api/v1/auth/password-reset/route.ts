import { NextRequest } from 'next/server';
import { redeemPasswordReset } from '@/lib/access/reset';
import { accessResponse, accessError } from '@/lib/access/http';
import { checkRateLimit, DEFAULT_PASSWORD_RESET_LIMIT } from '@/lib/auth/rateLimiter';
import { DomainError } from '@/lib/errors/codes';
import { getClientIp } from '@/lib/http';
export async function POST(req: NextRequest) {
  try {
    if (!checkRateLimit(`password-reset:${getClientIp(req) || 'unknown'}`, DEFAULT_PASSWORD_RESET_LIMIT).allowed) {
      throw new DomainError('RATE_LIMITED', 'Too many reset attempts. Please try again later.', {}, 429);
    }
    return accessResponse(await redeemPasswordReset(await req.json()));
  } catch (error) { return accessError(error); }
}

// Dependency-free cookie names shared by Edge middleware and server auth.
export const ACCESS_COOKIE_NAME = 'erp_access';
export const REFRESH_COOKIE_NAME = 'erp_refresh';
export const MFA_PENDING_COOKIE_NAME = 'erp_mfa_pending';
export function getAccessCookieName() { return ACCESS_COOKIE_NAME; }
export function getRefreshCookieName() { return REFRESH_COOKIE_NAME; }
export function getMfaPendingCookieName() { return MFA_PENDING_COOKIE_NAME; }

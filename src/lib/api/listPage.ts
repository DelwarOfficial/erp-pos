// Cursor pagination for list endpoints that returned every row.
//
// Reference-data lists (categories, brands, units, warehouses, chart of
// accounts...) were read with findMany and no limit: small today, but nothing
// bounded the query or the response. The UI fetches them without parameters to
// fill dropdowns, so the default page is the maximum -- existing callers see
// the same list unless it passes LIST_PAGE_MAX rows -- and every response says
// whether more remain (has_more, next_cursor) instead of stopping silently.
//
// Pages follow the list's own order with id as the tie-break, and the cursor is
// the last row's id (Prisma cursor pagination), so any sort order pages stably.

import { DomainError } from '@/lib/errors/codes';

export const LIST_PAGE_MAX = 1_000;

export interface ListPage {
  take: number;
  cursor?: string;
}

const CURSOR = /^[A-Za-z0-9-]{1,64}$/;

/** Reads `limit` and `cursor`. A malformed value is a 400, not a silent default. */
export function readListPage(url: URL): ListPage {
  const limitParam = url.searchParams.get('limit');
  const cursor = url.searchParams.get('cursor') ?? undefined;
  let take = LIST_PAGE_MAX;
  if (limitParam !== null) {
    take = Number(limitParam);
    if (!Number.isInteger(take) || take < 1 || take > LIST_PAGE_MAX) {
      throw new DomainError('VALIDATION_FAILED', `limit must be an integer from 1 to ${LIST_PAGE_MAX}`, { limit: limitParam }, 400);
    }
  }
  if (cursor !== undefined && !CURSOR.test(cursor)) {
    throw new DomainError('VALIDATION_FAILED', 'cursor is not valid', {}, 400);
  }
  return { take, cursor };
}

/** findMany arguments: one row more than the page, to learn whether more remain. */
export function listPageArgs(page: ListPage) {
  return {
    take: page.take + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
  };
}

export function listPageResult<T extends { id: string }>(rows: T[], page: ListPage) {
  const hasMore = rows.length > page.take;
  const items = hasMore ? rows.slice(0, page.take) : rows;
  return { items, has_more: hasMore, next_cursor: hasMore ? items[items.length - 1].id : null };
}

import { StonkValidationError } from "./errors";

/**
 * v2 cursor pagination. Every v2 list pages the same way: send
 * `limit` (1–100, default 25), `order` (desc default, or asc) and
 * `cursor`; each response carries `page: { limit, order, nextCursor }`.
 * For the next page, send `nextCursor` back as `cursor` with the SAME
 * order. Only `nextCursor: null` means the end — a page can hold fewer
 * rows than `limit`, or none at all, before the end. A cursor from a
 * different endpoint or order answers 400.
 */

export interface V2PageInfo {
  limit: number;
  order: "desc" | "asc";
  nextCursor: string | null;
}

export interface V2ListParams {
  /** 1–100, default 25. Out-of-range values are clamped by the venue. */
  limit?: number;
  order?: "desc" | "asc";
  cursor?: string;
}

/** One page of a v2 list, normalized to the rows + the raw page info. */
export interface V2Page<T> {
  items: T[];
  page: V2PageInfo;
}

/**
 * Stream every item of a v2 list. `fetchPage` is called with the
 * cursor for the next page (undefined for the first) and must return
 * the normalized page. Iteration stops ONLY when `nextCursor` is
 * null; short and empty pages are followed through. A repeated cursor
 * (a venue bug that would loop forever) throws instead.
 */
export async function* paginateV2<T>(
  fetchPage: (cursor: string | undefined) => Promise<V2Page<T>>,
  opts: { maxPages?: number } = {},
): AsyncGenerator<T, void, undefined> {
  const seen = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  for (;;) {
    if (opts.maxPages !== undefined && pages >= opts.maxPages) {
      throw new StonkValidationError(
        "maxPages",
        `paginateV2 exceeded maxPages=${opts.maxPages} without reaching nextCursor: null`,
      );
    }
    const page = await fetchPage(cursor);
    pages += 1;
    for (const item of page.items) yield item;
    const next = page.page.nextCursor;
    if (next === null) return;
    if (seen.has(next)) {
      throw new StonkValidationError(
        "cursor",
        `paginateV2 saw cursor "${next}" twice — refusing to loop forever`,
      );
    }
    seen.add(next);
    cursor = next;
  }
}

/** Collect every item of a v2 list into an array (see paginateV2). */
export async function collectV2<T>(
  fetchPage: (cursor: string | undefined) => Promise<V2Page<T>>,
  opts: { maxPages?: number } = {},
): Promise<T[]> {
  const out: T[] = [];
  for await (const item of paginateV2(fetchPage, opts)) out.push(item);
  return out;
}

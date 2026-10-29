import { describe, expect, it, vi } from "vitest";
import { collectV2, paginateV2, type V2Page } from "../src/paginate";
import { StonkValidationError } from "../src/errors";

function page(items: number[], nextCursor: string | null): V2Page<number> {
  return { items, page: { limit: 25, order: "desc", nextCursor } };
}

describe("paginateV2", () => {
  it("follows cursors until nextCursor is null, passing each cursor back", async () => {
    const pages = new Map<string | undefined, V2Page<number>>([
      [undefined, page([1, 2], "c1")],
      ["c1", page([3], "c2")],
      ["c2", page([4, 5], null)],
    ]);
    const fetchPage = vi.fn(async (cursor: string | undefined) => pages.get(cursor)!);
    const items = await collectV2(fetchPage);
    expect(items).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([undefined, "c1", "c2"]);
  });

  it("does NOT stop at a short page — only nextCursor: null ends iteration", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([1], "c1")) // short page, not the end
      .mockResolvedValueOnce(page([2], null));
    const items = await collectV2(fetchPage);
    expect(items).toEqual([1, 2]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("does NOT stop at an empty page", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page([], "c1"))
      .mockResolvedValueOnce(page([9], null));
    const items = await collectV2(fetchPage);
    expect(items).toEqual([9]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("refuses to loop forever on a repeated cursor", async () => {
    const fetchPage = vi.fn(async () => page([1], "same-cursor"));
    await expect(collectV2(fetchPage)).rejects.toBeInstanceOf(StonkValidationError);
  });

  it("honors maxPages as a hard stop", async () => {
    let n = 0;
    const fetchPage = vi.fn(async () => page([1], `c${(n += 1)}`));
    await expect(collectV2(fetchPage, { maxPages: 3 })).rejects.toBeInstanceOf(
      StonkValidationError,
    );
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("streams items as pages arrive", async () => {
    const seen: number[] = [];
    const responses: Array<V2Page<number>> = [page([1, 2], "c1"), page([3], null)];
    let i = 0;
    const fetchPage = async (): Promise<V2Page<number>> => responses[(i += 1) - 1]!;
    for await (const item of paginateV2(fetchPage)) seen.push(item);
    expect(seen).toEqual([1, 2, 3]);
  });
});

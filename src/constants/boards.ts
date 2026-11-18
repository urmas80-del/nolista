import { Brand } from './brand';

export const BOARD_ICONS: Record<string, string> = {
  market: 'cart-outline',
  together: 'people-outline',
  focus: 'bulb-outline',
  custom: 'ellipse-outline',
};

export const BOARD_ACCENTS: Record<string, { bg: string; text: string }> = {
  market: { bg: Brand.colors.sproutTint, text: Brand.colors.sproutDark },
  together: { bg: Brand.colors.marigoldTint, text: Brand.colors.marigoldDark },
  focus: { bg: Brand.colors.duskTint, text: Brand.colors.duskDark },
  custom: { bg: Brand.colors.stone, text: Brand.colors.ink },
};
const TYPE_ORDER: Record<string, number> = { market: 0, together: 1, focus: 2, custom: 3 };

/**
 * Built-in boards first (Market, Together, Focus, then custom), your own
 * board before shared ones of the same type, otherwise keep the given order
 * (oldest first). So merging or unmerging never pushes Market to the bottom.
 */
export function sortBoards<T extends { type: string; owner_id: string }>(
  boards: readonly T[],
  myId: string | null
): T[] {
  return boards
    .map((board, index) => ({ board, index }))
    .sort((a, b) => {
      const byType = (TYPE_ORDER[a.board.type] ?? 9) - (TYPE_ORDER[b.board.type] ?? 9);
      if (byType !== 0) return byType;
      const byOwner = Number(a.board.owner_id !== myId) - Number(b.board.owner_id !== myId);
      if (byOwner !== 0) return byOwner;
      return a.index - b.index;
    })
    .map(({ board }) => board);
}

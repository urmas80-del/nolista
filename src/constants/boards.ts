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
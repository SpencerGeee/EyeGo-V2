import type { Ionicons } from '@expo/vector-icons';
import type { ColorTokens } from '@eyego/config';
import type { RING_PALETTES } from './effects/GradientGlowBorder';

/**
 * ONE DESCRIPTION OF A RIDE TIER, FOR BOTH APPS.
 *
 * Before this file, "what colour is Comfort?" had at least five answers in the
 * codebase: `TierBadge` used `colors.tierComfort`, the rider's ride picker used
 * `colors.primary` for every tier (so Eco, Comfort and Premium were all the same
 * green), the glow ring's `comfort` palette used the premium blue instead of the
 * tier blue, the driver's create-trip tier step had no colour at all, and the
 * tracking card fell back to a grey when the server said `ECO` but the badge only
 * knew `ECONOMY`.
 *
 * That last one is the whole reason `normalizeTier` exists. The backend's rider
 * tier enum is `ECO | COMFORT | PREMIUM`; the badge component's was
 * `ECONOMY | COMFORT | PREMIUM | ROYAL`. `ECO` matched neither, so the lookup
 * returned undefined and the chosen-ride header rendered greyed-out — the rider
 * could not tell which tier they had just bought. Every consumer now normalizes
 * through here, so a new spelling is one line in one file rather than a silent
 * grey box on some screen nobody re-tested.
 */

export type TierId = 'ECONOMY' | 'COMFORT' | 'PREMIUM' | 'ROYAL';

/** Ring palette names that exist in `RING_PALETTES`, so a typo is a type error. */
type RingPalette = keyof typeof RING_PALETTES;

export interface TierTheme {
  id: TierId;
  /** Human label — "Economy", not "ECO". */
  label: string;
  /** One line on what the rider is buying. */
  blurb: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /** The tier's colour. Text, icons and prices on a tier surface use this. */
  accent: string;
  /** Tinted card fill for a selected tier card — accent at ~9 % over the surface. */
  softBg: string;
  /** Tinted border/rim for a tier card, and the icon pill's fill at ~18 %. */
  rim: string;
  /** Icon-pill fill. */
  iconBg: string;
  /** The matching animated glow ring, for `GradientGlowBorder palette={…}`. */
  ringPalette: RingPalette;
  /** Premium and Royal earn the shine sweep; Eco and Comfort do not. */
  shiny: boolean;
}

/**
 * Accepts anything the wire might carry — `ECO`, `economy`, `Comfort`, null —
 * and always answers with a tier the UI can render.
 */
export function normalizeTier(raw: string | null | undefined): TierId {
  const v = (raw ?? '').trim().toUpperCase();
  switch (v) {
    case 'ECO':
    case 'ECONOMY':
    case 'STANDARD':
    case 'SHARED':
      return 'ECONOMY';
    case 'COMFORT':
      return 'COMFORT';
    case 'PREMIUM':
      return 'PREMIUM';
    case 'ROYAL':
      return 'ROYAL';
    default:
      return 'ECONOMY';
  }
}

/** Hex + alpha byte. Kept local so this module has no runtime dependencies. */
const a = (hex: string, alphaByte: string) => `${hex}${alphaByte}`;

export function getTierTheme(colors: ColorTokens, raw: string | null | undefined): TierTheme {
  const id = normalizeTier(raw);
  const base: Record<TierId, { label: string; blurb: string; icon: TierTheme['icon']; accent: string; ringPalette: RingPalette; shiny: boolean }> = {
    ECONOMY: {
      label: 'Economy',
      blurb: 'Everyday, best price',
      icon: 'leaf-outline',
      accent: colors.tierEconomy,
      ringPalette: 'economy',
      shiny: false,
    },
    COMFORT: {
      label: 'Comfort',
      blurb: 'More room, air conditioning',
      icon: 'car-sport-outline',
      accent: colors.tierComfort,
      ringPalette: 'comfort',
      shiny: false,
    },
    PREMIUM: {
      label: 'Premium',
      blurb: 'Top-rated drivers, best cars',
      icon: 'diamond-outline',
      accent: colors.tierPremium,
      ringPalette: 'gold',
      shiny: true,
    },
    ROYAL: {
      label: 'Royal',
      blurb: 'Chauffeur service',
      icon: 'ribbon-outline',
      accent: colors.tierRoyal,
      ringPalette: 'royal',
      shiny: true,
    },
  };

  const t = base[id];
  return {
    id,
    ...t,
    softBg: a(t.accent, '17'),
    rim: a(t.accent, '59'),
    iconBg: a(t.accent, '2E'),
  };
}

/** Every tier a rider can choose, in the order they should be listed. */
export const RIDER_TIERS: TierId[] = ['ECONOMY', 'COMFORT', 'PREMIUM'];

/**
 * The wire value for a tier, for requests going back to the server. The rider
 * quote/booking API speaks `ECO`, not `ECONOMY`.
 */
export function tierToWire(id: TierId): 'ECO' | 'COMFORT' | 'PREMIUM' | 'ROYAL' {
  return id === 'ECONOMY' ? 'ECO' : id;
}

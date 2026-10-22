/**
 * Onboarding copy, in one place. Each slide's hero is the particle shape at
 * the same index in `shapes.ts` (van, cards, seats, pay, pin, mark).
 * `accent` is a theme token name, resolved against the palette at render.
 */
export interface Slide {
  title: string;
  subtitle: string;
  accent: 'primary' | 'secondary' | 'tierComfort' | 'statusWarning' | 'statusInfo' | 'onSurface';
}

export const SLIDES: Slide[] = [
  { title: 'Ride together. Pay less.', subtitle: 'Share a van with 8 to 14 people and split the fare.', accent: 'primary' },
  { title: 'Eco or Comfort.', subtitle: 'Pick budget or air-conditioned — your call.', accent: 'tierComfort' },
  { title: 'Pay only for your seat.', subtitle: 'Get off early and pay for just the road you ride.', accent: 'primary' },
  { title: 'Pay your way.', subtitle: 'Mobile money, card, or cash on board.', accent: 'statusWarning' },
  { title: 'Know where your ride is.', subtitle: 'Track your van live and get pickup updates.', accent: 'statusInfo' },
  { title: 'Built for Accra.', subtitle: 'Reliable group rides across the city.', accent: 'onSurface' },
];

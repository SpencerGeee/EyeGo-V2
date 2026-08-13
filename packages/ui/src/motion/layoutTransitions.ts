import { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { springs } from '@eyego/config';

/**
 * LAYOUT TRANSITIONS, FROM THE SAME SPRINGS AS EVERYTHING ELSE.
 *
 * Reanimated's layout animations solve the problem the sheet's translate does
 * not: when a row appears inside the panel — a promo line, a second fare
 * breakdown, an ETA that arrives late — everything below it must move down.
 * Without a layout transition that move happens in a single frame, so the sheet
 * grows smoothly (the spring) while its contents teleport inside it (no
 * spring). The two must be the same motion or the panel reads as a container
 * sliding over a list rather than as one surface.
 *
 * They are derived from the shared tokens rather than hand-tuned per screen, so
 * a change to the design system's feel reaches layout reflow too.
 *
 * ── COST ────────────────────────────────────────────────────────────────────
 * A layout transition is not free: Reanimated snapshots the subtree's frames
 * before and after every commit that touches it. Put them on the wrappers that
 * genuinely reflow, not on every view — a `layout` prop on a long list's rows
 * is a per-commit measurement of the whole list.
 *
 * ── REDUCE MOTION ───────────────────────────────────────────────────────────
 * Reanimated already disables these when the OS "Reduce Motion" switch is on,
 * so no separate accessibility path is needed here.
 */

/**
 * The panel's own reflow. Same spring as the sheet edge and the container
 * morph, so a row appearing and the sheet growing to fit it are one event.
 */
export const sheetContentLayout = LinearTransition.springify()
  .damping(springs.morph.damping)
  .stiffness(springs.morph.stiffness)
  .mass(springs.morph.mass);

/**
 * Rows, chips, list items — anything reflowing *inside* an already-settled
 * container. Quicker than the panel itself: small things that take as long as
 * large things to move read as sluggish.
 */
export const rowLayout = LinearTransition.springify()
  .damping(springs.standard.damping)
  .stiffness(springs.standard.stiffness)
  .mass(springs.standard.mass);

/**
 * Content arriving inside a surface that is already open. Deliberately a fade
 * with no travel: the surface has already done the moving, and a second
 * translate underneath it fights the first.
 */
export const contentEnter = FadeIn.duration(180);
export const contentExit = FadeOut.duration(120);

import { Platform } from 'react-native';

/**
 * ── PROMOTE A CONTINUOUSLY-ANIMATING VIEW TO A GPU TEXTURE ──────────────────
 *
 * Spread onto any `Animated.View` that runs a LOOP — a pulse, a rotating ring,
 * a shimmer, a drifting blob.
 *
 * WHY. On Android a View whose transform or opacity changes is re-rasterised by
 * the UI thread every frame: its whole subtree is re-drawn into the parent's
 * display list, 60 times a second, for as long as the loop runs.
 * `renderToHardwareTextureAndroid` draws it ONCE into an off-screen GPU texture
 * and then only re-composites that texture, which is what the transform is
 * actually asking for. For a looping view the difference is not subtle — it is
 * the difference between an animation that costs a redraw per frame and one
 * that costs a matrix multiply.
 *
 * iOS gets `shouldRasterizeIOS` for the same reason, but far more sparingly:
 * Core Animation already composites layer transforms on the GPU, so rasterising
 * mostly buys a cache that has to be invalidated whenever the layer's CONTENT
 * changes — and a rasterised layer that keeps invalidating is slower than one
 * that never rasterised. So this is Android-only by default, and iOS opts in
 * per call site only where the content is genuinely static.
 *
 * ── WHEN NOT TO USE THIS ───────────────────────────────────────────────────
 *
 * A texture is real GPU memory (width × height × 4 bytes), so:
 *
 *   - Only for LOOPING animations. A one-shot entrance finishes in 300 ms and
 *     would hold its texture for the life of the screen, which is a leak with
 *     good intentions.
 *   - Never on a view whose CONTENT changes every frame (a live map, a Skia
 *     canvas, a counting number). The texture would be invalidated and re-drawn
 *     on every one of those frames — strictly worse than not having it.
 *   - Never on something the size of several screens.
 *
 * Everything it is used on in this codebase animates transform/opacity only,
 * which is exactly the case it exists for.
 */
export const loopingLayerProps = Platform.OS === 'android'
  ? ({ renderToHardwareTextureAndroid: true } as const)
  : ({} as const);

/**
 * The same promotion for a looping layer whose content is also STATIC on iOS —
 * a shimmer over fixed text, a ring of fixed colours. Rasterising on iOS is
 * only correct when the pixels inside never change; see the note above.
 */
export const staticLoopingLayerProps = Platform.OS === 'android'
  ? ({ renderToHardwareTextureAndroid: true } as const)
  : ({ shouldRasterizeIOS: true } as const);

# React Doctor False Positives

## no-layout-property-animation

All `MotiView` / `MotiImage` / `MotiText` components from the `moti` library use
framer-motion–style `animate` / `from` / `transition` props but run on top of
Reanimated on the UI thread — they are NOT browser layout animations.
Suppress every `no-layout-property-animation` diagnostic in this codebase.

- apps/rider/app/ride/[id]/complete.tsx — MotiView with opacity/scale/translateY
- apps/rider/app/ride/[id]/cancel.tsx — MotiView with height transitions
- apps/rider/app/ride/select.tsx — MotiView with height transitions
- apps/rider/app/ride/[id]/payment.tsx — MotiView with height transitions
- apps/rider/app/ride/[id]/rate-tip.tsx — MotiView with height transitions
- apps/rider/app/ride/guest-selection.tsx — MotiView with height transitions
- apps/rider/app/profile/help.tsx — MotiView with height transitions
- apps/rider/app/profile/business.tsx — MotiView with height transitions
- apps/driver/app/(profile)/performance.tsx — MotiView with width transitions
- apps/driver/app/(profile)/documents.tsx — MotiView with width transitions
- apps/driver/app/(profile)/ratings.tsx — MotiView with width transitions

## effect-needs-cleanup

### NetInfo.addEventListener — returns unsubscribe directly

`NetInfo.addEventListener` returns an unsubscribe function. The pattern
`return NetInfo.addEventListener(handler)` is a valid React cleanup.
The rule does not recognise this because it expects `removeEventListener`.

- apps/rider/hooks/useNetworkStatus.ts — `return unsubscribe`
- apps/driver/hooks/useNetworkStatus.ts — `return unsubscribe`
- apps/driver/app/_layout.tsx — `return NetInfo.addEventListener(...)`

### setTimeout inside event callbacks (not scheduled on mount)

The `setTimeout` calls in the following effects are inside socket/event callbacks
handed off to an external emitter — they are not scheduled synchronously on mount
and therefore do not need cleanup by the effect.

- apps/driver/app/(tabs)/home.tsx — setTimeout inside `onDisconnect` handler
- apps/rider/components/TripStatusListener.tsx — setTimeout inside `onTripStatus` handler

### addEventListener with named unsubscribe returned via closure

- apps/driver/app/(trip)/chat/[id].tsx — `return () => unsubNet()`
- apps/rider/app/ride/[id]/chat.tsx — `return () => unsubNetInfo()`

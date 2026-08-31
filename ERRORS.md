# EyeGo V2 — Error Reference

## Backend Error Codes

| Code | HTTP | Meaning | Source |
|------|------|---------|--------|
| `NOT_FOUND` | 404 | Resource not found | `utils/errors.js` — `NotFoundError` |
| `FORBIDDEN` | 403 | Not authorized for action | `utils/errors.js` — `ForbiddenError` |
| `VALIDATION_ERROR` | 400 | Input validation failed | `middleware/validate.js` |
| `INVALID_LOCATION` | 400 | GPS outside service area | `modules/drivers/drivers.service.js` — `goOnline` |
| `NEGATIVE_WALLET_BALANCE` | 402 | Account suspended due to debt | `modules/drivers/drivers.service.js` — `goOnline` |
| `INSUFFICIENT_WALLET` | 402 | Driver cannot cover commission | `utils/errors.js` — `InsufficientWalletError` |
| `SEAT_TAKEN` | 409 | Seat already occupied | `modules/drivers/drivers.service.js` — `addOfflinePassenger` / `addCashNoPhone` |
| `OTP_INVALID` | 400 | Wrong OTP | `modules/drivers/drivers.service.js` — `verifyOfflineOtp` |
| `OTP_EXPIRED` | 400 | OTP has expired | `modules/drivers/drivers.service.js` — `verifyOfflineOtp` |
| `TRIP_NOT_COMPLETED` | 400 | Cannot rate before trip ends | `modules/drivers/drivers.service.js` — `ratePassenger` |
| `INVALID_STATUS` | 400 | Action not allowed in current trip state | `modules/drivers/drivers.service.js` — `cancelTrip` |
| `INVITE_EXPIRED` | 410 | Share invite link has expired | `modules/trips/trips.service.js` — `getTripByShareToken` |
| `NO_VEHICLE` | 400 | Driver has no registered vehicle | `modules/trips/trips.service.js` — `createTrip` |
| `AUTH_INVALID` | 401 | Bad credentials | `modules/auth/auth.service.js` |
| `AUTH_EXPIRED` | 401 | Token expired | `middleware/auth.js` |
| `AUTH_REVOKED` | 401 | Refresh token revoked | `modules/auth/auth.service.js` |
| `RATE_LIMITED` | 429 | Too many requests | `middleware/rateLimiter.js` |

## Frontend Error States

### Missing Data Handled (null/undefined guards)
- **Trips list**: `activeBooking` null check, `trip?.route?.originName ?? 'Origin'`
- **Wallet**: `balanceData?.data?.data?.balance ?? 0`
- **Chat**: `driver?.avatarUrl`, `driver?.name ?? 'Your Driver'`
- **Payment**: `(selectedTrip as any)?.fare ?? 0`
- **Promotions**: `user?.referralCode ?? null`

### Mutation Error Handling
- All `useMutation` calls have `onError` with user-facing `Alert.alert`
- Socket operations use try/catch with silent failure (non-critical)

## Common Gotchas

### Moti `transition` TypeScript Errors
Moti's spring/timing transitions don't accept inline object types. Use `as any` cast:
```tsx
transition={{ type: 'spring', stiffness: 600, damping: 34 } as any}
```

### Prisma `$transaction` Isolation
For seat-contention operations, use `isolationLevel: 'Serializable'`:
```js
await prisma.$transaction(async (tx) => { ... }, { isolationLevel: 'Serializable' });
```

### `process.env.NODE_ENV` in Frontend
In Expo/React Native, use `__DEV__` instead of `process.env.NODE_ENV`:
```ts
if (__DEV__) { /* dev-only code */ }
```

### WebSocket Reconnection
Socket auto-reconnects on network restore. The chat outbox (AsyncStorage) persists pending messages and replays on reconnect.

## Error Boundary
- `ErrorBoundary` wraps the entire rider app in `_layout.tsx`
- Global exception handler set up for `__DEV__` logging
- `SplashScreen` has a 4s timeout fallback

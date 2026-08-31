# EyeGo E2E harness

Drives the **real** server over HTTP and socket.io. Not a mock in sight: it
signs users up, prices rides, books them, runs the dispatch cascade, moves money
and reads the results back through a different door than the one that wrote them.

Static analysis proves *"this cannot work"*. Only a running server proves
*"this does"* — and the whole class of defect this codebase keeps producing is
invisible to a screenshot, because the failure is a `null` on a payload rather
than a crash.

## Running it

```bash
# 1. bring the stack up
docker compose up -d          # postgres + redis
cd eyego-api && npm start     # NODE_ENV=development, so /auth returns _dev_otp

# 2. run everything
yarn e2e

# ...or one suite
yarn e2e:wallet
node scripts/e2e/run-all.mjs geo wallet   # anything matching those words
```

`E2E_BASE` points it elsewhere (default `http://127.0.0.1:5020`). It **refuses**
to run against a non-local host unless `E2E_ALLOW_REMOTE=1`, because it writes
users, trips and wallet rows. Never point it at production.

Exit code is the number of failed **suites**, so CI can gate on it.

## The suites

| Suite | What it proves |
| --- | --- |
| `geo-routing.mjs` | The polyline is a road and not a ruler; the geocoder returns a street and not "Accra"; the ETA is traffic-aware and not free-flow. |
| `rider-happy-path.mjs` | request → dispatch → accept → drive → complete → pay, asserting **both** sides at every step. |
| `driver-happy-path.mjs` | The driver-created group trip, end to end. |
| `rider-features.mjs` | Saved places, scheduling, invites, disputes, support. |
| `driver-features.mjs` | Earnings, quests, documents, destination mode. |
| `rider-settings.mjs` | Profile, preferences, notifications, account. |
| `rider-edges.mjs` | The rider paths that are not the happy one. |
| `dispatch-payload.mjs` | The offer **contract** — every field the driver's card and map read, on all three delivery surfaces (REST offer, board row, socket frame), and that they agree. |
| `wallet-commission.mjs` | The cash float: advertised at the offer, refused at accept, charged exactly once at boarding, and zero for prepaid rides. |
| `lifecycle-edges.mjs` | Cancellations, accept races, no-shows, terminal states that must stay terminal. |
| `silent-failures.mjs` | Writes that do not write, settings nobody reads, and 200s that mean nothing. |

`purge-test-data.mjs` and `reset-pool.mjs` clean up after a run that left rows
or a driver online.

## How to read a failure

Every check is phrased as **what the user would experience**, not as an
assertion that tripped. A red line like

```
✗ ACCEPT is refused with 402 INSUFFICIENT_WALLET_FOR_TRIP —
    a driver who cannot pay the commission was allowed to ACCEPT. They will
    drive to the pickup and be refused at boarding.
```

is a bug report you can hand to someone. That is deliberate: a harness whose
failures need interpreting gets ignored the second time it goes red.

## Writing a new suite

Import from `lib.mjs` and use `check()` rather than bare asserts, so one
failure does not abort the run:

```js
import { section, check, summary, GET, POST, makeRider, ACCRA } from './lib.mjs';

section('1 · the thing');
await check('the user-visible claim, in a sentence', async () => {
  const r = await GET('/whatever', { token: rider.token });
  if (!r.ok) throw new Error('what the user will see instead, and why it matters');
  return 'the detail printed next to the tick';
});
```

Three rules that keep it honest:

1. **Never assert on a status code alone.** Write, then read back through a
   different endpoint. A 200 is not evidence.
2. **Say what breaks, not what is missing.** `"walletRequiredPesewas is absent —
   the driver cannot be warned before accepting"` beats `"expected number"`.
3. **Suites run serially and share one dispatch pool.** Take your drivers
   offline in `finally`, or the next suite waits out your offer windows.

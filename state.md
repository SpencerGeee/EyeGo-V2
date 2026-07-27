# State

## Current Goal
Verify rider→driver trip dispatch works end-to-end after rebuilding the apps.

## Decisions
See session-log.md 2026-07-26 02:30 entry for full details.

## Plan Status
- Camera crash (ride/[id].tsx): fixed, committed, pushed (9834b98).
- Redis fallback (geoadd/geosearch/georadius/sadd/smembers): fixed, committed, pushed (6609ffa).
- Backend running locally via `npm run dev` (eyego-api), port 5020, nodemon watching.

## Evidence
- Pulled on-device crash report (EyeGo-2026-07-24-124830.ips) confirmed MLRNCamera SIGABRT — not a Hermes/JS red herring.
- Verified in-memory geosearch/georadius manually: near driver matched within radius, far driver correctly excluded.
- Backend process that was running earlier had died independently (unrelated to any edit) — restarted, confirmed clean boot.

## Open Issues
- User needs to rebuild both apps (native rebuild required — Camera fix is JS but needs a fresh binary; also good time to pick up all other session fixes).
- Not yet confirmed: does the installed app actually reach 192.168.1.38:5020? EXPO_PUBLIC_API_URL is unset in all EAS environments (production/preview/development) — unclear how current builds resolve their API host. Verify this BEFORE assuming dispatch is fixed.
- Commit the redis.js fallback fix once rebuild testing confirms it works.

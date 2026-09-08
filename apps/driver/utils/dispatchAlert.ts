import { AppState, Platform, Vibration } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * THE DRIVER IS NOT LOOKING AT THE PHONE.
 *
 * FEATURE ("when a new request comes, the only time it shows up is when you see
 * the card on the homepage or the dispatch page. It needs to pop up so if the
 * driver isn't looking, he sees it. You need to add a sound implementation for
 * new rides so the driver is instantly notified").
 *
 * The takeover sheet was already mounted at the root, so an offer DID cover
 * whatever screen the driver was on — but a silent takeover on a phone in a
 * cradle, screen dimmed, at a junction, is a takeover nobody attends. Dispatch
 * gives the driver 45 seconds and the first several of those are spent noticing.
 *
 * ── WHAT THIS IS ────────────────────────────────────────────────────────────
 * A repeating alert for as long as an offer is live: a chime, a strong haptic,
 * and on Android a vibration pattern (which fires even when the screen is off).
 * It repeats rather than firing once because the whole point is the driver who
 * was not looking at the moment it arrived.
 *
 * ── WHY THE AUDIO DEPENDENCY IS OPTIONAL ────────────────────────────────────
 * `expo-audio` is not yet installed in this app. Rather than make the alert
 * conditional on a native rebuild, the module is resolved at call time and the
 * alert degrades to haptics + vibration — which is most of the value, works
 * today, and needs no new binary. Installing the package turns the sound on
 * with no further code change:
 *
 *     npx expo install expo-audio        (run from apps/driver)
 *
 * The same shape as `screenFocus.ts`'s optional navigation peer, and for the
 * same reason: a missing peer should cost a feature, not the app.
 */

/** How often the alert repeats while an offer is still live. */
const REPEAT_MS = 4000;
/** Never nag past the longest offer window; a stuck timer is a furious driver. */
const MAX_ALERT_MS = 60_000;

type AudioModule = {
  createAudioPlayer?: (source: any) => any;
  setAudioModeAsync?: (mode: any) => Promise<void>;
};

let audio: AudioModule | null | undefined;

/** Resolve `expo-audio` once. `null` means "asked and it isn't there". */
function getAudio(): AudioModule | null {
  if (audio !== undefined) return audio;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    audio = require('expo-audio') as AudioModule;
  } catch {
    audio = null;
  }
  return audio;
}

let player: any = null;

function ensurePlayer(): any {
  if (player) return player;
  const mod = getAudio();
  if (!mod?.createAudioPlayer) return null;
  try {
    /**
     * The alert must survive the phone being on silent, because a driver on
     * silent is the exact case this exists for. On iOS that means declaring
     * playback (not ambient) audio; the switch still wins for genuinely
     * background media, which is why the vibration below is never optional.
     */
    void mod.setAudioModeAsync?.({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
    }).catch(() => {});
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    player = mod.createAudioPlayer(require('../assets/sounds/new-ride.wav'));
    return player;
  } catch {
    return null;
  }
}

/**
 * Android's `Vibration.vibrate(pattern)` reaches a driver whose screen is off
 * and whose phone is face-down in a cradle, which `expo-haptics` does not. iOS
 * ignores the pattern, so it keeps the haptic there.
 */
const ANDROID_PATTERN = [0, 400, 180, 400];

function pulse() {
  try {
    if (Platform.OS === 'android') {
      Vibration.vibrate(ANDROID_PATTERN, false);
    } else {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  } catch {
    /* a phone that cannot vibrate must not take the offer down with it */
  }
}

function chime() {
  const p = ensurePlayer();
  if (!p) return;
  try {
    // `seekTo(0)` then play, so a repeat restarts the sound rather than being
    // swallowed because the player is already at the end of the clip.
    p.seekTo?.(0);
    p.play?.();
  } catch {
    /* ignore — the haptic already fired */
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let stopAt = 0;
/** The offer this alert belongs to, so a re-render cannot restart it. */
let activeKey: string | null = null;

/**
 * Start alerting for `key` (the offer/trip id). Idempotent: calling it again
 * for the same key while it is already running does nothing, which matters
 * because the caller is a React effect that can re-run for unrelated reasons.
 */
export function startDispatchAlert(key: string, opts?: { enabled?: boolean }): void {
  if (opts?.enabled === false) return;
  if (activeKey === key && timer) return;
  stopDispatchAlert();
  activeKey = key;
  stopAt = Date.now() + MAX_ALERT_MS;

  // Fire immediately — the first alert is the one that matters.
  pulse();
  chime();

  timer = setInterval(() => {
    if (Date.now() >= stopAt) {
      stopDispatchAlert();
      return;
    }
    // A backgrounded app cannot usefully chime (iOS will refuse anyway) and a
    // driver who has switched away is being reached by the push instead.
    if (AppState.currentState !== 'active') return;
    pulse();
    chime();
  }, REPEAT_MS);
}

/** Stop alerting. Safe to call when nothing is running. */
export function stopDispatchAlert(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  activeKey = null;
  try {
    if (Platform.OS === 'android') Vibration.cancel();
  } catch {
    /* noop */
  }
}

/** Test/diagnostic — is an alert currently running, and for what. */
export function dispatchAlertState(): { running: boolean; key: string | null } {
  return { running: !!timer, key: activeKey };
}

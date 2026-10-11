'use strict';

/**
 * Per-connection send budget for chat. Every message is also a push on the
 * other person's phone, so an unthrottled `chat:send` loop was a way to flood
 * a driver (or a whole bus) with notifications. 20 a minute is far above any
 * real conversation.
 * ponytail: per socket, so a reconnect resets it — Redis-backed if abuse shows up.
 */
function chatThrottle(limit = 20, windowMs = 60_000) {
  const sent = [];
  return function allowed() {
    const now = Date.now();
    while (sent.length && now - sent[0] > windowMs) sent.shift();
    if (sent.length >= limit) return false;
    sent.push(now);
    return true;
  };
}

module.exports = { chatThrottle };

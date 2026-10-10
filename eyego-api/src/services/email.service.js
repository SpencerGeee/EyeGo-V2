'use strict';

const env = require('../config/env');
const logger = require('../utils/logger');

/**
 * EMAIL — Resend, over plain HTTPS (no SDK).
 *
 * Off until RESEND_API_KEY is set: `send` resolves null and nothing else in the
 * app changes. Never throws — a receipt email is a courtesy copy, and the trip it
 * describes has already completed by the time it is sent.
 */
const isConfigured = () => !!env.RESEND_API_KEY;

async function send({ to, subject, html, text }) {
  if (!isConfigured() || !to) return null;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: Array.isArray(to) ? to : [to], subject, html, text }),
    });
    if (!res.ok) {
      logger.warn('[email] send failed', { status: res.status, body: (await res.text()).slice(0, 300) });
      return null;
    }
    return await res.json();
  } catch (err) {
    logger.warn('[email] send failed', { error: err.message });
    return null;
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * A trip receipt. `lines` are [label, amount-string] pairs already formatted
 * by the caller (money is formatted once, at the edge, with formatGhs).
 */
function receiptEmail({ receiptNumber, dateText, from, to, driverName, lines, total, paymentMethod, company }) {
  const rows = lines.map(([l, v]) => `<tr><td style="padding:6px 0;color:#555">${esc(l)}</td><td style="padding:6px 0;text-align:right">${esc(v)}</td></tr>`).join('');
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f5f7;padding:24px">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
<h2 style="margin:0 0 4px">Your EyeGo receipt</h2>
<p style="margin:0 0 20px;color:#777">${esc(dateText)} · ${esc(receiptNumber)}</p>
${company ? `<p style="margin:0 0 16px;color:#333"><strong>${esc(company)}</strong></p>` : ''}
<p style="margin:0 0 4px"><strong>From</strong> ${esc(from)}</p>
<p style="margin:0 0 4px"><strong>To</strong> ${esc(to)}</p>
${driverName ? `<p style="margin:0 0 16px"><strong>Driver</strong> ${esc(driverName)}</p>` : ''}
<table style="width:100%;border-collapse:collapse;margin-top:12px">${rows}
<tr><td style="padding:10px 0;border-top:1px solid #eee"><strong>Total</strong></td><td style="padding:10px 0;border-top:1px solid #eee;text-align:right"><strong>${esc(total)}</strong></td></tr></table>
<p style="color:#777;margin-top:16px">Paid by ${esc(paymentMethod)}</p>
</div></body></html>`;
  const text = [`Your EyeGo receipt ${receiptNumber} — ${dateText}`, `${from} → ${to}`, ...lines.map(([l, v]) => `${l}: ${v}`), `Total: ${total}`, `Paid by ${paymentMethod}`].join('\n');
  return { subject: `Your EyeGo receipt — ${total}`, html, text };
}

module.exports = { isConfigured, send, receiptEmail };

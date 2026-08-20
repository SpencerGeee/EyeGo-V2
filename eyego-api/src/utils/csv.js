'use strict';

/**
 * RFC 4180 CSV, written by hand.
 *
 * Not a dependency, because the entire specification that matters is the
 * escaping rule below, and the failure mode of getting it wrong — a comma
 * inside an address silently shifting every later column — is exactly the kind
 * of thing a finance team discovers a month later in a reconciliation.
 */

/**
 * Quote a single field.
 *
 * Rules, in order:
 *  - null/undefined become empty, NOT the strings "null"/"undefined".
 *  - Dates go out as ISO 8601, which every spreadsheet and database reads.
 *  - A field containing a comma, quote, CR or LF is wrapped in quotes, and any
 *    embedded quote is doubled.
 *  - A leading =, +, - or @ is prefixed with a single quote. Excel and Sheets
 *    treat those as the start of a FORMULA, so an exported name like
 *    "=cmd|' /c calc'!A1" becomes code execution on the machine of whoever
 *    opens the file. This is CSV injection, and export endpoints are its
 *    classic vector.
 */
function escapeField(value) {
  if (value === null || value === undefined) return '';

  let s;
  if (value instanceof Date) s = value.toISOString();
  else if (typeof value === 'object') s = JSON.stringify(value);
  else s = String(value);

  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;

  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** One data row, given an ordered column spec. */
function toRow(record, columns) {
  return columns
    .map((col) => escapeField(typeof col.value === 'function' ? col.value(record) : record[col.key]))
    .join(',');
}

/** The header line. */
function toHeader(columns) {
  return columns.map((c) => escapeField(c.label ?? c.key)).join(',');
}

/**
 * Render a whole dataset.
 *
 * A BOM leads the file: without it Excel on Windows decodes UTF-8 as the
 * system codepage, and every Ghanaian name with an accent arrives mangled.
 */
function toCsv(records, columns, { bom = true } = {}) {
  const lines = [toHeader(columns), ...records.map((r) => toRow(r, columns))];
  return (bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}

/**
 * A `Content-Disposition` value that survives non-ASCII filenames.
 * Both forms are sent: `filename` for old clients, `filename*` (RFC 5987) for
 * everything since.
 */
function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

module.exports = { escapeField, toCsv, toRow, toHeader, contentDisposition };

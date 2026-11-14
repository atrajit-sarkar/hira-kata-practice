/**
 * Minimal, read-only archive helpers: gzip + POSIX ustar (with GNU/pax header skipping)
 * and a quote-aware CSV parser. Everything works in memory on untrusted input; nothing
 * extracted is written to disk or executed.
 */
import { gunzipSync } from 'node:zlib';

const BLOCK = 512;
const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;

/** Read a NUL-terminated ASCII/UTF-8 field from a tar header. */
function readField(buf, offset, length) {
  const slice = buf.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? length : end).toString('utf8');
}

/** Parse a tar numeric field (octal text, or GNU base-256 for very large values). */
function readSize(buf, offset, length) {
  if (buf[offset] & 0x80) {
    let value = 0;
    for (let i = offset + 1; i < offset + length; i += 1) value = value * 256 + buf[i];
    return value;
  }
  const text = readField(buf, offset, length).trim();
  if (text && !/^[0-7]+$/.test(text)) throw new Error(`Corrupt tar header: bad size field "${text}"`);
  return text ? parseInt(text, 8) : 0;
}

/**
 * List the regular files in a gzip-compressed tar archive.
 * Pax extended headers ('x', 'g') and GNU long-name headers ('L', 'K') are honoured
 * for the member name and otherwise skipped.
 * @param {Buffer} tgz gzip-compressed tar bytes
 * @returns {{ name: string, data: Buffer }[]}
 */
export function readTarGz(tgz) {
  const tar = gunzipSync(tgz, { maxOutputLength: MAX_UNPACKED_BYTES });
  const files = [];
  let offset = 0;
  let pendingName = null;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break; // end-of-archive marker
    const size = readSize(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const dataStart = offset + BLOCK;
    if (dataStart + size > tar.length) throw new Error('Corrupt tar archive: member extends past end of data');
    const data = tar.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'L') {
      pendingName = readField(data, 0, data.length);
      continue;
    }
    if (type === 'x') {
      const match = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8'));
      if (match) pendingName = match[1];
      continue;
    }
    if (type === 'g' || type === 'K') continue;

    const prefix = readField(header, 345, 155);
    const base = readField(header, 0, 100);
    const name = pendingName ?? (prefix ? `${prefix}/${base}` : base);
    pendingName = null;
    if (type === '0' || type === '\0') files.push({ name, data: Buffer.from(data) });
  }
  return files;
}

/**
 * Parse RFC 4180 CSV text (quoted fields, doubled quotes, embedded commas and newlines).
 * A UTF-8 BOM and CRLF line endings are accepted. Blank lines are skipped.
 * @param {string} text
 * @returns {string[][]} rows of fields
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const endRow = () => {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
    field = '';
  };
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      endRow();
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new Error('Malformed CSV: unterminated quoted field');
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * Parse CSV text with a header row into objects keyed by column name.
 * @param {string} text
 * @param {string[]} requiredColumns columns that must be present in the header
 * @returns {Record<string, string>[]}
 */
export function parseCsvRecords(text, requiredColumns = []) {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const names = header.map((h) => h.trim());
  const missing = requiredColumns.filter((c) => !names.includes(c));
  if (missing.length) throw new Error(`CSV is missing column(s): ${missing.join(', ')}`);
  return rows.map((cells) => Object.fromEntries(names.map((n, i) => [n, cells[i] ?? ''])));
}

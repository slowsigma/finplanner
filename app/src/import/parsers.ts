// SPDX-License-Identifier: Apache-2.0
// Parse-only transaction import (A3): bank CSV exports and OFX/QFX statements
// are parsed in memory for preview; nothing is persisted automatically, and
// the app never talks to a bank (D3, D8).

export interface ParsedTransaction {
  date: string;
  amount: number;
  description: string;
  fitid?: string;
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  warnings: string[];
}

const DATE_ALIASES = [
  "date", "trans date", "posting date", "transaction date", "booking date", "book date", "val date",
  "datum", "buchungstag", "buchungsdatum",
];
const AMOUNT_ALIASES = [
  "amount", "transaction amount", "value", "total", "debit/credit", "sum", "betrag", "umsatz",
];
const DESC_ALIASES = [
  "description", "memo", "payee", "details", "narrative", "name", "reference",
  "verwendungszweck", "empfaenger", "auftraggeber",
];
const FITID_ALIASES = ["fitid", "transaction id", "txn id", "id"];

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/^"|"$/g, "").replace(/_/g, " ");
}

function pickColumn(headers: string[], aliases: string[]): number {
  const norm = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const i = norm.findIndex((h) => h === alias || h.startsWith(`${alias} `));
    if (i >= 0) return i;
  }
  for (const alias of aliases) {
    const i = norm.findIndex((h) => h.includes(alias.replace(/ /g, "")) || h.includes(alias));
    if (i >= 0) return i;
  }
  return -1;
}

export function parseDate(raw: string): string | null {
  const s = raw.trim().replace(/^"|"$/g, "");
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return null;
}

export function parseAmount(raw: string, decimalComma = false): number | null {
  let s = raw.trim().replace(/^"|"$/g, "").replace(/\s/g, "");
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()\-+]/g, "").replace(/[€£$]/g, "").replace(/[^\d.,]/g, "");
  if (s === "") return null;
  if (decimalComma) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  }
  const v = Number.parseFloat(s);
  if (Number.isNaN(v)) return null;
  return negative ? -v : v;
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseCsv(text: string): ParseResult {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { transactions: [], warnings: ["no data rows found"] };
  const counts: Record<string, number> = {};
  for (const d of [",", ";", "\t"]) counts[d] = (lines[0]!.match(new RegExp(`\\${d}`, "g")) ?? []).length;
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0];
  const headers = splitCsvLine(lines[0]!, delim);
  const dateCol = pickColumn(headers, DATE_ALIASES);
  const amountCol = pickColumn(headers, AMOUNT_ALIASES);
  const descCol = pickColumn(headers, DESC_ALIASES);
  const fitidCol = pickColumn(headers, FITID_ALIASES);
  if (dateCol < 0 || amountCol < 0) {
    return { transactions: [], warnings: ["could not identify date and amount columns"] };
  }
  const decimalComma = delim === ";";
  const transactions: ParsedTransaction[] = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, delim);
    const date = cells[dateCol] !== undefined ? parseDate(cells[dateCol]!) : null;
    const amount = cells[amountCol] !== undefined ? parseAmount(cells[amountCol]!, decimalComma) : null;
    if (date === null || amount === null) { skipped += 1; continue; }
    const fitid = fitidCol >= 0 && cells[fitidCol] ? cells[fitidCol]!.trim() : undefined;
    transactions.push({
      date,
      amount,
      description: descCol >= 0 && cells[descCol] ? cells[descCol]!.trim().replace(/^"|"$/g, "") : "",
      ...(fitid ? { fitid } : {}),
    });
  }
  if (skipped > 0) warnings.push(`${skipped} row(s) skipped: unparseable date or amount`);
  return { transactions, warnings };
}

function ofxTag(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]+)`, "i"));
  return m ? m[1]!.trim() : undefined;
}

export function parseOfx(text: string): ParseResult {
  const warnings: string[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  if (blocks.length === 0) return { transactions: [], warnings: ["no <STMTTRN> blocks found"] };
  const transactions: ParsedTransaction[] = [];
  let skipped = 0;
  for (const block of blocks) {
    const rawDate = ofxTag(block, "DTSTART");
    const rawAmount = ofxTag(block, "AMOUNT");
    const date = rawDate ? parseDate(rawDate) : null;
    const amount = rawAmount ? parseAmount(rawAmount) : null;
    if (date === null || amount === null) { skipped += 1; continue; }
    const fitid = ofxTag(block, "FITID");
    transactions.push({
      date,
      amount,
      description: ofxTag(block, "NAME") ?? ofxTag(block, "MEMO") ?? "",
      ...(fitid ? { fitid } : {}),
    });
  }
  if (skipped > 0) warnings.push(`${skipped} transaction(s) skipped: unparseable DTSTART or AMOUNT`);
  return { transactions, warnings };
}

export function parseImport(text: string): ParseResult {
  const looksOfx = /<OFX|<SIGNATURESR|<STMTTRN/i.test(text.slice(0, 4000)) || /<STATEMENTTRN/i.test(text);
  return looksOfx ? parseOfx(text) : parseCsv(text);
}

// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { parseCsv, parseImport, parseOfx } from "../src/import/parsers.ts";

const usCsv = [
  "Date,Description,Amount,Balance",
  "01/15/2026,\"ACME PAYROLL, INC\",4250.00,5120.33",
  "01/18/2026,GROCERS #1234,-84.15,5036.18",
  "01/20/2026,ELECTRIC UTIL,120.00,4916.18",
].join("\n");

const euCsv = [
  "Buchungstag;Verwendungszweck;Betrag",
  "15.01.2026;GEHALT;2.500,00",
  "20.01.2026;MIETWAAGE;-850,00",
].join("\n");

const ofx = `OFXHEADER:100
DATA:OFXSGML
<OFX>
<STMTTRN>
<TRNTYPE>CREDIT
<DTSTART>20260115120000[-05:00]
<AMOUNT>4250.00
<NAME>ACME PAYROLL
<FITID>20260115/1
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTSTART>20260118
<AMOUNT>-84.15
<MEMO>GROCERS #1234
</STMTTRN>
<STMTTRN>
<DTSTART>not-a-date
<AMOUNT>10.00
</STMTTRN>
</OFX>`;

describe("CSV import (A3)", () => {
  it("US export: headers, quoted commas, MM/DD/YYYY, thousands", () => {
    const r = parseCsv(usCsv);
    expect(r.transactions).toHaveLength(3);
    expect(r.transactions[0]).toMatchObject({ date: "2026-01-15", amount: 4250, description: "ACME PAYROLL, INC" });
    expect(r.transactions[1]).toMatchObject({ date: "2026-01-18", amount: -84.15 });
  });

  it("EU export: semicolons, DD.MM.YYYY, dot thousands / comma decimals", () => {
    const r = parseCsv(euCsv);
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[0]).toMatchObject({ date: "2026-01-15", amount: 2500 });
    expect(r.transactions[1]!.amount).toBeCloseTo(-850);
  });

  it("unidentified columns and junk rows degrade to warnings, not crashes", () => {
    const bad = parseCsv("foo,bar\n1,2");
    expect(bad.transactions).toHaveLength(0);
    expect(bad.warnings.join(" ")).toContain("columns");
    const partial = parseCsv("Date,Amount\n2026-01-01,10\nnope,nope");
    expect(partial.transactions).toHaveLength(1);
    expect(partial.warnings.join(" ")).toContain("1 row");
  });

  it("parentheses denote negatives", () => {
    const r = parseCsv("Date,Amount\n2026-01-01,(45.00)");
    expect(r.transactions[0]!.amount).toBe(-45);
  });
});

describe("OFX import (A3)", () => {
  it("SGML blocks with signed amounts and FITIDs", () => {
    const r = parseOfx(ofx);
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[0]).toMatchObject({ date: "2026-01-15", amount: 4250, description: "ACME PAYROLL", fitid: "20260115/1" });
    expect(r.transactions[1]).toMatchObject({ date: "2026-01-18", amount: -84.15, description: "GROCERS #1234" });
    expect(r.warnings.join(" ")).toContain("1 transaction");
  });
});

describe("format sniffing", () => {
  it("routes OFX vs CSV by content", () => {
    expect(parseImport(ofx).transactions).toHaveLength(2);
    expect(parseImport(usCsv).transactions).toHaveLength(3);
  });
});

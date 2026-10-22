// SPDX-License-Identifier: Apache-2.0
// A3 parse-only import: bank statements (CSV/OFX) are parsed in the browser
// for preview and duplicate detection only — never auto-posted, never sent
// anywhere (D3, D8).

import { useState } from "react";
import { parseImport, type ParseResult } from "../import/parsers.ts";
import { money } from "./ui.tsx";

export function ImportTab() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<ParseResult | null>(null);

  const runParse = (source: string) => {
    setText(source);
    setResult(source.trim() === "" ? null : parseImport(source));
  };

  const dupes = new Set<string>();
  if (result) {
    const seen = new Set<string>();
    for (const t of result.transactions) {
      const key = t.fitid ?? `${t.date}|${t.amount}|${t.description}`;
      if (seen.has(key)) dupes.add(key);
      seen.add(key);
    }
  }

  return (
    <section className="card">
      <h2>Statement import — parse-only preview (A3)</h2>
      <p className="note dim">
        Paste a CSV export or OFX/QFX statement, or load a file. Nothing is stored automatically and
        nothing leaves this device — review the preview, then enter the transactions you care about
        by hand.
      </p>
      <input
        type="file"
        accept=".csv,.ofx,.qfx,.txt,text/plain"
        data-testid="import-file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => runParse(String(reader.result ?? ""));
          reader.readAsText(file);
        }}
      />
      <textarea
        rows={8}
        value={text}
        placeholder={"Date,Description,Amount\n01/15/2026,ACME PAYROLL,4250.00"}
        data-testid="import-text"
        onChange={(e) => setText(e.target.value)}
      />
      <button
        type="button"
        data-testid="parse-import"
        onClick={() => runParse(text)}
      >
        Parse statement
      </button>
      {result && (
        <>
          {result.warnings.map((w) => (
            <p key={w} className="note dim" data-testid="import-warning">{w}</p>
          ))}
          <p className="dim" data-testid="import-count">
            {result.transactions.length} transaction(s) parsed{dupes.size > 0 ? ` · ${dupes.size} duplicate(s) in file` : ""}
          </p>
          {result.transactions.length > 0 && (
            <table data-testid="import-table">
              <thead>
                <tr><th>Date</th><th>Description</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {result.transactions.map((t, i) => {
                  const key = t.fitid ?? `${t.date}|${t.amount}|${t.description}`;
                  return (
                    <tr key={`${key}-${i}`} className={dupes.has(key) ? "dim" : undefined}>
                      <td>{t.date}</td>
                      <td>{t.description || "—"}</td>
                      <td className={t.amount >= 0 ? "num pos" : "num neg"}>{money(t.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

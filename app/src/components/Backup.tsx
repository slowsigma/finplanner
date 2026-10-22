// SPDX-License-Identifier: Apache-2.0
// Backup = encrypted whole-file export/import (D3/D4). The container is a
// serialized SQLite database: a 2027 file opens in the 2040 build.
import { useState, type ChangeEvent } from "react";
import { decryptContainer, encryptContainer } from "@finplanner/shared-schema";
import type { AppDatabase } from "../db/sqlite.ts";
import { emptyTemplate } from "../db/repo.ts";

export function Backup({ db, refresh }: { db: AppDatabase; refresh: () => void }) {
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [exportPassword, setExportPassword] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [file, setFile] = useState<File | undefined>();

  const doExport = async () => {
    setError("");
    setStatus("");
    try {
      const sealed = await encryptContainer(db.serialize(), exportPassword);
      const url = URL.createObjectURL(new Blob([sealed as BlobPart], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `finplanner-${new Date().toISOString().slice(0, 10)}.fpx`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus("Export saved (AES-256-GCM). Store it somewhere safe — it is the only copy.");
    } catch (e) {
      setError(String(e));
    }
  };

  const doImport = async () => {
    if (!file) return;
    setError("");
    setStatus("");
    if (!confirm("Replace ALL current data with this export? This cannot be undone.")) return;
    try {
      const bytes = await decryptContainer(new Uint8Array(await file.arrayBuffer()), importPassword);
      db.import(bytes);
      await db.persist();
      setStatus("Import complete.");
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const doWipe = async () => {
    if (!confirm("Erase all data from this device? (Export first — this cannot be undone.)")) return;
    setError("");
    try {
      const template = await emptyTemplate();
      db.import(template);
      await db.persist();
      setStatus("Device wiped.");
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <>
      <section className="card">
        <h2>Backup — export (encrypted)</h2>
        <form className="inline" data-testid="export-form" onSubmit={(e) => { e.preventDefault(); void doExport(); }}>
          <label>Password
            <input
              type="password"
              value={exportPassword}
              onChange={(e) => setExportPassword(e.target.value)}
              data-testid="export-password"
              required
            />
          </label>
          <button className="primary" type="submit" data-testid="export-button">Export file</button>
        </form>
      </section>
      <section className="card">
        <h2>Restore — import</h2>
        <form className="inline" data-testid="import-form" onSubmit={(e) => { e.preventDefault(); void doImport(); }}>
          <label>File
            <input
              type="file"
              accept=".fpx,application/octet-stream"
              data-testid="import-file"
              onChange={(e: ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0])}
              required
            />
          </label>
          <label>Password
            <input
              type="password"
              value={importPassword}
              onChange={(e) => setImportPassword(e.target.value)}
              data-testid="import-password"
              required
            />
          </label>
          <button className="primary" type="submit" data-testid="import-button">Import & replace</button>
        </form>
      </section>
      <section className="card">
        <h2>Wipe this device</h2>
        <button className="link" type="button" data-testid="wipe-button" onClick={() => void doWipe()}>
          Erase everything
        </button>
      </section>
      {status && <p className="pos" data-testid="backup-status">{status}</p>}
      {error && <p className="err" data-testid="backup-error">{error}</p>}
      <p className="note dim">
        Exports are AES-256-GCM encrypted (PBKDF2-SHA256, 600k iterations) and contain the full
        local database. The same file format is the multi-device transfer story: export here,
        import there. There is no cloud.
      </p>
    </>
  );
}

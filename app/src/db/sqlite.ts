// SPDX-License-Identifier: Apache-2.0
// sqlite-wasm boot + OPFS connection (D4). The published .d.mts for
// @sqlite.org/sqlite-wasm 3.54 is out of sync with its runtime export
// (it declares classes the module never exports), so the small slice of
// the classic `oo1` C-wrapper API we use is typed here explicitly.

import initSqlite3 from "@sqlite.org/sqlite-wasm";
import type { BindValue, SqlDatabase } from "@finplanner/shared-schema";
import { opfsWrite } from "./persist.ts";

export interface Sqlite3Statics {
  capi: Record<string, (...args: never[]) => unknown>;
  wasm: {
    alloc(size: number): number;
    dealloc(ptr: number, size: number): void;
    poke64(ptr: number, value: number): void;
    peek64(ptr: number): bigint;
    heap8u(): Uint8Array;
  };
  oo1: {
    DB: new (filename: string, flags?: string) => Sqlite3Database;
  };
}

export interface Sqlite3Database {
  exec(sql: string): void;
  exec(opts: { sql: string; bind?: BindValue[] }): void;
  exec(opts: { sql: string; bind?: BindValue[]; rowMode: "array" | "object"; returnValue: "resultRows" }): Record<string, unknown>[] | unknown[][];
  pointer: number;
  close(): void;
}

let staticsPromise: Promise<Sqlite3Statics> | undefined;

function sqlite3(): Promise<Sqlite3Statics> {
  staticsPromise ??= initSqlite3() as unknown as Promise<Sqlite3Statics>;
  return staticsPromise;
}

export class AppDatabase {
  private constructor(
    readonly sqlite3: Sqlite3Statics,
    readonly db: Sqlite3Database,
    /** False when the browser lacks the async OPFS API: the session is ephemeral. */
    readonly persistent: boolean,
  ) {}

  /** SQLite itself always runs on memory; durability comes from opfs snapshots. */
  static async open(): Promise<AppDatabase> {
    const s = await sqlite3();
    const db = new s.oo1.DB(":memory:", "cw");
    const persistent = typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function";
    return new AppDatabase(s, db, persistent);
  }

  /** Snapshot the live database to OPFS (call after every mutation). */
  async persist(): Promise<void> {
    if (this.persistent) await opfsWrite(this.serialize());
  }

  /** Adapter for the shared migration runner and repositories. */
  get sql(): SqlDatabase {
    const db = this.db;
    return {
      exec: (sql) => db.exec(sql),
      run: (sql, ...params) => {
        db.exec({ sql, bind: params });
      },
      all: (sql, ...params) =>
        db.exec({ sql, bind: params, rowMode: "object", returnValue: "resultRows" }) as Record<string, unknown>[],
      get: (sql, ...params) =>
        (db.exec({ sql, bind: params, rowMode: "object", returnValue: "resultRows" }) as Record<string, unknown>[])[0],
    };
  }

  /** Whole-file snapshot for the encrypted export container (D3 backup). */
  serialize(): Uint8Array {
    const s = this.sqlite3;
    const capi = s.capi as unknown as Record<string, (...args: unknown[]) => unknown>;
    const pSize = s.wasm.alloc(8);
    try {
      s.wasm.poke64(pSize, 0);
      const p = capi["sqlite3_serialize"]!(this.db.pointer, "main", pSize, 0) as number;
      if (!p) throw new Error("sqlite3_serialize returned null");
      const size = Number(s.wasm.peek64(pSize));
      const copy = s.wasm.heap8u().slice(p, p + size);
      capi["sqlite3_free"]!(p);
      return copy;
    } finally {
      s.wasm.dealloc(pSize, 8);
    }
  }

  /**
   * Replace the live database's contents with a deserialized copy (import
   * & wipe). Hot-backup'd into the live OPFS file so the on-disk state
   * stays consistent; refuses data that fails an integrity check.
   */
  import(bytes: Uint8Array): void {
    const s = this.sqlite3;
    const capi = s.capi as unknown as Record<string, (...args: unknown[]) => unknown>;
    const tmp = new s.oo1.DB(":memory:", "cw");
    const p = capi["sqlite3_malloc"]!(bytes.length) as number;
    if (!p) throw new Error(`sqlite3_malloc(${bytes.length}) failed`);
    try {
      s.wasm.heap8u().set(bytes, p);
      // SQLITE_DESERIALIZE_FREEONCLOSE(1) | RESIZE(2) | READONLY(4)
      const rc = capi["sqlite3_deserialize"]!(tmp.pointer, "main", p, bytes.length, bytes.length, 3) as number;
      if (rc !== 0) throw new Error(`sqlite3_deserialize failed (rc ${rc})`);
      const check = tmp.exec({ sql: "PRAGMA integrity_check", rowMode: "array", returnValue: "resultRows" }) as unknown[][];
      const verdict = String(check[0]?.[0]);
      if (verdict !== "ok") throw new Error(`imported database failed integrity_check: ${verdict}`);
      const backup = capi["sqlite3_backup_init"]!(this.db.pointer, "main", tmp.pointer, "main");
      if (!backup) throw new Error(`backup_init failed: ${String(capi["sqlite3_errmsg"]!(this.db.pointer))}`);
      // SQLITE_BUSY = 5, SQLITE_LOCKED = 6, SQLITE_DONE = 101
      let step = capi["sqlite3_backup_step"]!(backup, -1) as number;
      while (step === 5 || step === 6) step = capi["sqlite3_backup_step"]!(backup, -1) as number;
      capi["sqlite3_backup_finish"]!(backup);
      if (step !== 101) throw new Error(`backup_step failed (rc ${step})`);
    } finally {
      tmp.close();
    }
  }
}

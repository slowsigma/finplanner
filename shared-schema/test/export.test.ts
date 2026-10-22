// SPDX-License-Identifier: Apache-2.0
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { decryptContainer, encryptContainer, migrate } from "../src/index.ts";
import { dumpAll, seedDemoHousehold, wrapNodeSqlite } from "./nodeAdapter.ts";

function seededDb(): DatabaseSync {
  const raw = new DatabaseSync(":memory:");
  const db = wrapNodeSqlite(raw);
  migrate(db);
  seedDemoHousehold(db);
  return raw;
}

describe("encrypted export container (D3/D4 backup story)", () => {
  it("export -> wipe -> re-import reproduces every row exactly (G1 core)", async () => {
    const source = seededDb();
    const before = dumpAll(wrapNodeSqlite(source));
    const exported = await encryptContainer(source.serialize(), "correc t horse battery 🐫");

    const raw = await decryptContainer(exported, "correc t horse battery 🐫");
    const restored = new DatabaseSync(":memory:");
    restored.deserialize(raw);
    const after = dumpAll(wrapNodeSqlite(restored));
    expect(after).toStrictEqual(before);
    expect(before["persons"]).toHaveLength(2);
    expect(before["accounts"]).toHaveLength(5);
  });

  it("rejects wrong password, tampered ciphertext, and non-exports", async () => {
    const exported = await encryptContainer(seededDb().serialize(), "right");
    await expect(decryptContainer(exported, "wrong")).rejects.toThrow(/wrong password or corrupted/);

    const tampered = new Uint8Array(exported);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1]! + 1) % 256;
    await expect(decryptContainer(tampered, "right")).rejects.toThrow(/wrong password or corrupted/);

    await expect(decryptContainer(new TextEncoder().encode("hello world, not an export"), "x"))
      .rejects.toThrow(/bad magic/);
  });

  it("same plaintext encrypts to different bytes each time (fresh salt+iv)", async () => {
    const plaintext = new TextEncoder().encode("same bytes");
    const a = await encryptContainer(plaintext, "pw");
    const b = await encryptContainer(plaintext, "pw");
    expect(a).not.toStrictEqual(b);
    expect(await decryptContainer(a, "pw")).toStrictEqual(plaintext);
    expect(await decryptContainer(b, "pw")).toStrictEqual(plaintext);
  });

  it("empty password is refused", async () => {
    await expect(encryptContainer(new Uint8Array(1), "")).rejects.toThrow(/must not be empty/);
  });
});

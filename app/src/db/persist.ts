// SPDX-License-Identifier: Apache-2.0
// D4 over the *async* OPFS API (works without SharedArrayBuffer, hence
// without COOP/COEP headers — required by D3's static-only distribution).
// The whole database is snapshot as a single file after every mutation;
// at this data scale (a few hundred rows) serialize+write is sub-
// millisecond. The bytes are identical to the export container's payload.

const DB_FILE = "finplanner.db";

export function opfsAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function" &&
    typeof FileSystemFileHandle !== "undefined"
  );
}

export async function opfsRead(): Promise<Uint8Array | undefined> {
  if (!opfsAvailable()) return undefined;
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(DB_FILE);
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    // Missing file is a fresh install; any other failure must not be treated
    // as "no data", or the next mutation could overwrite a recoverable snapshot.
    if (typeof error === "object" && error !== null && "name" in error && error.name === "NotFoundError") {
      return undefined;
    }
    throw error;
  }
}

export async function opfsWrite(bytes: Uint8Array): Promise<void> {
  if (!opfsAvailable()) throw new Error("OPFS unavailable");
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(DB_FILE, { create: true });
  const writable = await handle.createWritable();
  await writable.write(bytes as unknown as BlobPart);
  await writable.close();
}

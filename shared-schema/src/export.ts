// SPDX-License-Identifier: Apache-2.0
// Encrypted export/import container = the backup & multi-device story (D3/D4).
// FPX1: "FPX1" magic, u32be header length, JSON header, then AES-256-GCM
// ciphertext with the 16-byte tag appended. Key from PBKDF2-SHA256/600k.
// The plaintext is a serialized SQLite database file, so a 2027 export is a
// valid database file in 2040 as long as the container format is stable.

const MAGIC = "FPX1";
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

interface Header {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  cipher: "AES-GCM";
  salt: string;
  iv: string;
}

function b64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function b64Decode(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptContainer(plaintext: Uint8Array, password: string): Promise<Uint8Array> {
  if (password.length === 0) throw new Error("export password must not be empty");
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  ));
  const header: Header = {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    cipher: "AES-GCM",
    salt: b64Encode(salt),
    iv: b64Encode(iv),
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(MAGIC.length + 4 + headerBytes.length + sealed.length);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(4, headerBytes.length, false);
  out.set(headerBytes, 8);
  out.set(sealed, 8 + headerBytes.length);
  return out;
}

export async function decryptContainer(container: Uint8Array, password: string): Promise<Uint8Array> {
  const decoder = new TextDecoder("ascii", { fatal: false });
  if (container.length < 8 || decoder.decode(container.subarray(0, 4)) !== MAGIC) {
    throw new Error("not a FinPlanner export (bad magic)");
  }
  const headerLen = new DataView(container.buffer, container.byteOffset, container.byteLength).getUint32(4, false);
  if (container.length < 8 + headerLen + TAG_BYTES) throw new Error("truncated export container");
  const header = JSON.parse(decoder.decode(container.subarray(8, 8 + headerLen))) as Header;
  if (header.v !== 1 || header.kdf !== "PBKDF2-SHA256" || header.cipher !== "AES-GCM") {
    throw new Error(`unsupported export format (v${String(header.v)} ${String(header.kdf)}/${String(header.cipher)})`);
  }
  const key = await deriveKey(password, b64Decode(header.salt), header.iterations);
  const sealed = container.subarray(8 + headerLen);
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64Decode(header.iv) as BufferSource },
      key,
      sealed as BufferSource,
    ));
  } catch {
    throw new Error("decryption failed: wrong password or corrupted export");
  }
}

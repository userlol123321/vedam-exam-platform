import CryptoJS from "crypto-js";

// Client-side mirrors of the server encryption (uses same AES + secret key)
export function decrypt(ciphertext, key) {
  if (!ciphertext || !key) return null;
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, key);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch {
    return null;
  }
}

export function decryptJson(ciphertext, key) {
  const str = decrypt(ciphertext, key);
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

// In-memory only — never persists plaintext questions
let memoryCache = new Map();

export function cachePlaintext(key, value) {
  memoryCache.set(key, value);
}

export function getCached(key) {
  return memoryCache.get(key);
}

export function clearMemoryCache() {
  memoryCache = new Map();
}
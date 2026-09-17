const CryptoJS = require("crypto-js");

function encrypt(text, secretKey) {
  if (text === null || text === undefined) return null;
  return CryptoJS.AES.encrypt(String(text), secretKey).toString();
}

function decrypt(ciphertext, secretKey) {
  if (!ciphertext) return null;
  const bytes = CryptoJS.AES.decrypt(ciphertext, secretKey);
  try {
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (err) {
    return null;
  }
}

function encryptJson(obj, secretKey) {
  return encrypt(JSON.stringify(obj), secretKey);
}

function decryptJson(ciphertext, secretKey) {
  const str = decrypt(ciphertext, secretKey);
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch (err) {
    return null;
  }
}

function generateTestKey() {
  return CryptoJS.lib.WordArray.random(32).toString(CryptoJS.enc.Hex);
}

module.exports = {
  encrypt,
  decrypt,
  encryptJson,
  decryptJson,
  generateTestKey,
};
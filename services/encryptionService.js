const crypto = require("crypto");

const ALGORITHM = "aes-256-cbc";
const MASTER_KEY = process.env.ENCRYPTION_MASTER_KEY;

if (!MASTER_KEY || MASTER_KEY.length < 32) {
  throw new Error("ENCRYPTION_MASTER_KEY debe tener al menos 32 caracteres en .env");
}

const key = crypto.createHash("sha256").update(MASTER_KEY).digest();

function encrypt(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

function decrypt(encryptedData) {
  const [ivHex, encryptedHex] = encryptedData.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

module.exports = {
  encrypt,
  decrypt
};

// cryptoUtils.js
const crypto = require('crypto');
require('dotenv').config();

const algorithm = 'aes-256-cbc';
const key = Buffer.from(process.env.ENCRYPTION_KEY);

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

// function decrypt(text) {
//   const textParts = text.split(':');
//   const iv = Buffer.from(textParts.shift(), 'hex');
//   const encryptedText = Buffer.from(textParts.join(':'), 'hex');
//   const decipher = crypto.createDecipheriv(algorithm, key, iv);
//   let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
//   decrypted += decipher.final('utf8');
//   return decrypted;
// }


function decrypt(text) {
  try {
    const textParts = text.split(':');
    if (textParts.length < 2) {
      throw new Error("Invalid encrypted data format");
    }

    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');

    if (iv.length !== 16) {
      throw new Error("Invalid IV length");
    }

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;

  } catch (error) {
    console.error("Decryption error:", error.message);
    throw error; 
  }
}




module.exports = { encrypt, decrypt };

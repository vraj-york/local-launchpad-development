import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
// Fallback check to prevent the crash you're seeing
const KEY = process.env.ENCRYPTION_KEY;

export const encryptId = (id) => {
    if (!KEY || KEY.length !== 32) {
        throw new Error("ENCRYPTION_KEY must be 32 characters long.");
    }
    if (!id) return null;

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(KEY), iv);

    // Ensure id is a string before encrypting
    let encrypted = cipher.update(String(id), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
};

export const decryptId = (encryptedData) => {
    try {
        if (!KEY || !encryptedData) return null;

        const [ivHex, authTagHex, encryptedHex] = encryptedData.split(':');

        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(KEY), iv);

        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        console.error("Decryption Error:", error.message);
        return null;
    }
};


export const encryptAllIds = (data) => {
    // Handle null/undefined
    if (data === null || data === undefined) return data;
    //  Return Dates (or other special objects) immediately
    if (data instanceof Date) return data;
    // If it's an array, map over each element
    if (Array.isArray(data)) {
        return data.map(item => encryptAllIds(item));
    }

    // If it's an object, iterate through keys
    if (typeof data === 'object') {
        const transformed = {};
        for (const [key, value] of Object.entries(data)) {
            // Check if key is an ID field and value is a number
            if ((key === 'id' || key.endsWith('Id')) && typeof value === 'number') {
                transformed[key] = encryptId(value);
            }
            // If value is nested (object or array), recurse
            else if (typeof value === 'object') {
                transformed[key] = encryptAllIds(value);
            }
            else {
                transformed[key] = value;
            }
        }
        return transformed;
    }
    return data;
};
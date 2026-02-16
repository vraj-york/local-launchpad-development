import { decryptId } from "../utils/encryptionHelper.js";

export const decryptRequestMiddleware = (req, res, next) => {
    const decryptObject = (obj) => {
        for (const key in obj) {
            // If the key suggests it's an ID and it's a string
            if ((key === 'id' || key.endsWith('Id')) && typeof obj[key] === 'string') {
                const decrypted = decryptId(obj[key]);
                if (decrypted !== null) {
                    obj[key] = decrypted;
                }
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                decryptObject(obj[key]);
            }
        }
    };

    if (req.params) decryptObject(req.params);
    if (req.body) decryptObject(req.body);
    if (req.query) decryptObject(req.query);

    next();
};
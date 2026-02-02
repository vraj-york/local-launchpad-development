import { validationResult } from "express-validator";
import ApiError from "../utils/apiError.js";

export const validate = (req, res, next) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        const firstError = errors.array()[0];
        throw new ApiError(400, firstError.msg);
    }

    next();
};

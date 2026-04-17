import ApiError from "../utils/apiError.js";

const errorMiddleware = (err, req, res, next) => {
    console.error(err);

    if (err instanceof ApiError) {
        const body = { error: err.message };
        if (err.code) body.code = err.code;
        return res.status(err.statusCode).json(body);
    }

    return res.status(500).json({
        error: "Internal Server Error",
    });
};

export default errorMiddleware;
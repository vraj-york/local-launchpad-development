import asyncHandler from "../middleware/asyncHandler.middleware.js";
import {
  registerUserService,
  loginUserService,
  getMeService,
  updateMeService,
} from "../services/auth.service.js";

export const authController = {
  register: asyncHandler(async (req, res) => {
    const { name, email, password, role } = req.body;
    const user = await registerUserService({ name, email, password, role });
    res.json(user);
  }),

  login: asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const data = await loginUserService({ email, password });
    res.json(data);
  }),

  getMe: asyncHandler(async (req, res) => {
    const data = await getMeService(req.user.id);
    res.json(data);
  }),

  updateMe: asyncHandler(async (req, res) => {
    const data = await updateMeService(req.user.id, req.body || {});
    res.json(data);
  }),
};

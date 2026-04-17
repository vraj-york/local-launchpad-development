import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import ApiError from "../utils/apiError.js";

export async function listManagersService() {
  return prisma.user.findMany({
    where: { role: "manager" },
    select: {
      id: true,
      name: true,
      email: true,
    },
  });
}

export async function registerUserService({ name, email, password, role }) {
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    return await prisma.user.create({
      data: { name, email, password: hashedPassword, role },
    });
  } catch {
    throw new ApiError(400, "Email already exists");
  }
}

export async function loginUserService({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new ApiError(400, "Invalid credentials");
  }
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    throw new ApiError(400, "Invalid credentials");
  }
  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "30d" },
  );
  return { token, user };
}

export async function getMeService(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, image: true },
  });
  if (!user) {
    throw new ApiError(404, "User not found");
  }
  return { user };
}

export async function updateMeService(userId, body) {
  const { name, image } = body || {};
  const updateData = {};
  if (typeof name === "string" && name.trim()) updateData.name = name.trim();
  if (typeof image === "string") updateData.image = image.trim() || null;
  if (Object.keys(updateData).length === 0) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, image: true },
    });
    return { user: user || null };
  }
  const user = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: { id: true, name: true, email: true, role: true, image: true },
  });
  return { user };
}

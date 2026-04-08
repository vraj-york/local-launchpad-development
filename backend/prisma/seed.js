import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";

const DEFAULT_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
const DEFAULT_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "admin123";
const DEFAULT_ADMIN_NAME = process.env.SEED_ADMIN_NAME || "admin";

async function main() {
  const existing = await prisma.user.findUnique({
    where: { email: DEFAULT_ADMIN_EMAIL },
  });
  if (existing) {
    console.log("Seed: Admin user already exists, skipping.");
    return;
  }
  const hashedPassword = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
  await prisma.user.create({
    data: {
      name: DEFAULT_ADMIN_NAME,
      email: DEFAULT_ADMIN_EMAIL,
      password: hashedPassword,
      role: "admin",
    },
  });
  console.log("Seed: Created default admin user:", DEFAULT_ADMIN_EMAIL);
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

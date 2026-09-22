import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
  // eslint-disable-next-line no-var
  var pgPoolGlobal: Pool;
}

let connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Missing DATABASE_URL environment variable. Please set DATABASE_URL in your environment.");
}

// Defensive check: Ensure port 5432 is present if omitted to prevent pg getaddrinfo ENOTFOUND on Windows
if (connectionString.includes(".neon.tech/") && !connectionString.includes(".neon.tech:")) {
  connectionString = connectionString.replace(".neon.tech/", ".neon.tech:5432/");
}

const pool =
  global.pgPoolGlobal ??
  new Pool({
    connectionString,
    port: 5432,
    ssl: { rejectUnauthorized: false },
    max: 10,
  });

if (process.env.NODE_ENV !== "production") {
  global.pgPoolGlobal = pool;
}

const adapter = new PrismaPg(pool);

const prisma =
  global.prismaGlobal ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.prismaGlobal = prisma;
}

export default prisma;
export * from "@prisma/client";

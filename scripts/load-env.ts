import { existsSync } from "node:fs";

// Next.js loads .env itself; standalone tsx scripts need this (Node >= 20.12).
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

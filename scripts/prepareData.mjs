import fs from "fs";
import path from "path";

/**
 * Runs before `next start` in production. When DATA_DIR points at a mounted
 * persistent volume, seed it from the repo's bundled ./data on first boot
 * (never overwriting anything that already exists on the volume).
 */
const bundled = path.join(process.cwd(), "data");
const target = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : bundled;

if (target === bundled) {
  console.log("[prepareData] DATA_DIR not set — using ./data in the app directory.");
} else {
  fs.mkdirSync(target, { recursive: true });
  if (fs.existsSync(bundled)) {
    fs.cpSync(bundled, target, { recursive: true, force: false, errorOnExist: false });
  }
  console.log(`[prepareData] Persistent data directory ready at ${target}.`);
}

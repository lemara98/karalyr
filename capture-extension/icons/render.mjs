// Rasterise icon.svg into the toolbar PNGs Chrome asks for.
//   node capture-extension/icons/render.mjs
// sharp comes in with Next.js, so there is nothing extra to install.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(here, "icon.svg"));

// 16 toolbar, 32 Windows, 48 extensions page, 128 store/install dialog.
for (const size of [16, 32, 48, 128]) {
  await sharp(svg, { density: 384 }) // render large, downsample: keeps the thin bars clean
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(join(here, `icon${size}.png`));
  console.log(`icon${size}.png`);
}

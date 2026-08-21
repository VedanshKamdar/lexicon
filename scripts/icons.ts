/**
 * Generates the PWA icon set. Run after changing the mark:
 *
 *   npx tsx scripts/icons.ts
 *
 * The glyph is drawn as plain rectangles rather than <text>, because SVG text
 * rasterises against whatever fonts the rendering machine happens to have — a
 * serif "L" would silently become something else on a different box.
 */
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const INK = '#131211';
const PAPER = '#faf9f7';

/**
 * A slab-serif L on a 512 grid. Everything sits inside the middle 80%, which is
 * the maskable safe zone, so one artwork serves both `any` and `maskable`.
 */
const mark = `
  <rect x="128" y="112" width="120" height="28" fill="${PAPER}"/>
  <rect x="164" y="112" width="56" height="288" fill="${PAPER}"/>
  <rect x="164" y="372" width="220" height="28" fill="${PAPER}"/>
  <rect x="356" y="344" width="28" height="56" fill="${PAPER}"/>
`;

const svg = (background: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="${background}"/>
  ${mark}
</svg>`;

const targets = [
  { file: 'public/icon-192.png', size: 192 },
  { file: 'public/icon-512.png', size: 512 },
  // iOS does not mask or round this one itself, and a transparent background
  // would render as black, so it keeps the same opaque ink field.
  { file: 'public/apple-touch-icon.png', size: 180 },
  { file: 'public/favicon-32.png', size: 32 },
];

const source = Buffer.from(svg(INK));

for (const { file, size } of targets) {
  await sharp(source).resize(size, size).png().toFile(file);
  console.log(`${file}  ${size}x${size}`);
}

await writeFile('public/icon.svg', svg(INK));
console.log('public/icon.svg');

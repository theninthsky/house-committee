// Renders the app icon (SVG) into the PNG sizes the PWA manifest and iOS need.
// Run: npm run icons
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';

/** Artwork drawn on a 512 grid. `scale` shrinks it toward the center (maskable safe zone). */
function art(scale = 1) {
  const t = `translate(256 256) scale(${scale}) translate(-256 -256)`;
  const windows = [];
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 3; c++)
      windows.push(`<rect x="${182 + c * 52}" y="${150 + r * 54}" width="32" height="34" rx="6" fill="#1f6feb" opacity="0.9"/>`);
  return `
  <g transform="${t}">
    <!-- building -->
    <rect x="150" y="104" width="212" height="304" rx="18" fill="#ffffff"/>
    <rect x="138" y="92" width="236" height="30" rx="12" fill="#e6efff"/>
    ${windows.join('\n    ')}
    <rect x="206" y="356" width="48" height="52" rx="8" fill="#0f1b2d" opacity="0.85"/>
    <!-- coin badge -->
    <circle cx="362" cy="364" r="82" fill="#0f3a8a"/>
    <circle cx="362" cy="364" r="70" fill="#22a35a"/>
    <circle cx="362" cy="364" r="58" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="4"/>
    <!-- ₪ drawn as strokes -->
    <g transform="translate(326 328) scale(0.72)" fill="none" stroke="#ffffff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 90 V10 H60 V62"/>
      <path d="M90 10 V90 H40 V38"/>
    </g>
  </g>`;
}

const bg = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#3b86ff"/><stop offset="1" stop-color="#1446a0"/></linearGradient></defs>`;

// "any": rounded tile with a little margin
const anySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}
  <rect x="16" y="16" width="480" height="480" rx="108" fill="url(#g)"/>${art(0.86)}</svg>`;
// "maskable": full-bleed background, artwork inside the 80% safe zone
const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}
  <rect width="512" height="512" fill="url(#g)"/>${art(0.72)}</svg>`;
// iOS adds its own rounded corners and dislikes transparency
const appleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}
  <rect width="512" height="512" fill="url(#g)"/>${art(0.8)}</svg>`;

const render = (svg, size, file) => {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(`public/icons/${file}`, png);
  console.log('wrote', file);
};

writeFileSync('public/icons/icon.svg', anySvg);
render(anySvg, 192, 'icon-192.png');
render(anySvg, 512, 'icon-512.png');
render(maskSvg, 192, 'icon-maskable-192.png');
render(maskSvg, 512, 'icon-maskable-512.png');
render(appleSvg, 180, 'apple-touch-icon.png');
render(anySvg, 32, 'favicon-32.png');

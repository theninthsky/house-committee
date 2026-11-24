
const A4_PX = 794; // A4 width at 96dpi

/**
 * Render a DOM element into an A4 PDF. The browser itself renders the HTML (via SVG foreignObject),
 * so Hebrew / RTL text comes out exactly as on screen.
 * The element is cloned into an off-screen, fixed-width container so the result does not depend on window size.
 */
export async function elementToPdf(el: HTMLElement): Promise<Blob> {
  const [{ jsPDF }, { toJpeg }] = await Promise.all([import('jspdf'), import('html-to-image')]);
  const host = document.createElement('div');
  host.setAttribute('dir', 'rtl');
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${A4_PX}px;background:#fff;`;
  const clone = el.cloneNode(true) as HTMLElement;
  clone.style.margin = '0';
  clone.style.width = A4_PX + 'px';
  clone.style.maxWidth = 'none';
  clone.style.border = '0';
  host.appendChild(clone);
  document.body.appendChild(host);
  let jpeg: string;
  try {
    await document.fonts?.ready;
    jpeg = await toJpeg(clone, { pixelRatio: 2, quality: 0.9, backgroundColor: '#ffffff', skipFonts: true });
  } finally {
    host.remove();
  }
  const img = new Image();
  img.src = jpeg;
  await img.decode();
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const pageW = 210;
  const pageH = 297;
  const margin = 6;
  const w = pageW - margin * 2;
  const h = (img.height / img.width) * w;
  if (h <= pageH - margin * 2) {
    pdf.addImage(jpeg, 'JPEG', margin, margin, w, h);
  } else {
    const sliceHpx = Math.floor(((pageH - margin * 2) / w) * img.width);
    let y = 0;
    let first = true;
    while (y < img.height) {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = Math.min(sliceHpx, img.height - y);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, y, img.width, c.height, 0, 0, img.width, c.height);
      if (!first) pdf.addPage();
      pdf.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', margin, margin, w, (c.height / img.width) * w);
      first = false;
      y += sliceHpx;
    }
  }
  return pdf.output('blob');
}

export async function shareOrDownload(blob: Blob, fileName: string, text: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], fileName, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: fileName, text });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}

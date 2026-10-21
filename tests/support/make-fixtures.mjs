import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(here, '..', 'fixtures');

async function makePdf(filename, title, pages) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= pages; index += 1) {
    const page = document.addPage([612, 792]);
    page.drawText(`${title} / PAGE ${index}`, {
      x: 72,
      y: 700,
      size: 26,
      font,
      color: rgb(0.06, 0.1, 0.08),
    });
    page.drawText('PaperLab native text layer must remain selectable.', {
      x: 72,
      y: 660,
      size: 12,
      font,
      color: rgb(0.32, 0.35, 0.3),
    });
  }
  const bytes = await document.save();
  await fs.writeFile(path.join(fixtureDir, filename), bytes);
}

async function makeImage(filename) {
  const width = 800;
  const height = 600;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      png.data[index] = Math.round((x / width) * 220) + 20;
      png.data[index + 1] = Math.round((y / height) * 160) + 60;
      png.data[index + 2] = 140;
      png.data[index + 3] = 255;
    }
  }
  await fs.writeFile(path.join(fixtureDir, filename), PNG.sync.write(png));
}

export default async function globalSetup() {
  await fs.mkdir(fixtureDir, { recursive: true });
  await makePdf('sample-alpha.pdf', 'PAPERLAB ALPHA', 2);
  await makePdf('sample-beta.pdf', 'PAPERLAB BETA', 2);
  await makeImage('sample-image.png');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await globalSetup();
  console.log('fixtures written to', fixtureDir);
}

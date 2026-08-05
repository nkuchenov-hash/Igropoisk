import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { imageSize } from 'image-size';

const root = process.cwd();
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const write = (file, value) => fs.writeFileSync(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`);

const config = read('config/parsers/official-popular-art.json');
const rankingPath = 'data/popular/current.json';
const coversPath = 'data/popular/covers.json';
const data = read(rankingPath);
const covers = fs.existsSync(path.join(root, coversPath)) ? read(coversPath) : {};
const packages = new Map((config.packages || []).map(item => [item.slug, item]));

const dimensions = bytes => {
  try {
    const result = imageSize(bytes);
    return { width: Number(result.width || 0), height: Number(result.height || 0) };
  } catch {
    return { width: 0, height: 0 };
  }
};

let resolved = 0;
const failures = [];
for (const item of data.ranking || []) {
  const pkg = packages.get(item.slug);
  if (!pkg) continue;

  const temporary = path.join(os.tmpdir(), `igropoisk-${item.slug}-${process.pid}.zip`);
  try {
    const response = await fetch(pkg.package_url, {
      signal: AbortSignal.timeout(60_000),
      headers: { 'user-agent': 'Mozilla/5.0 IgropoiskOfficialArtResolver/1.0' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const archive = Buffer.from(await response.arrayBuffer());
    if (archive.length < 100_000) throw new Error('Official artwork package is unexpectedly small');
    fs.writeFileSync(temporary, archive);

    const image = execFileSync('unzip', ['-p', temporary, pkg.member], {
      maxBuffer: 20 * 1024 * 1024
    });
    const size = dimensions(image);
    const minimumWidth = Number(pkg.minimum_width || 500);
    const minimumHeight = Number(pkg.minimum_height || 700);
    const minimumRatio = Number(pkg.minimum_portrait_ratio || 1.2);
    if (
      image.length < 40_000 ||
      size.width < minimumWidth ||
      size.height < minimumHeight ||
      size.height / size.width < minimumRatio
    ) {
      throw new Error(`Official portrait failed dimensions: ${size.width}x${size.height}`);
    }

    const relative = `assets/covers/popular/${item.slug}.jpg`;
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), image);

    item.image = relative;
    item.image_candidates = [relative];
    item.cover_source = pkg.source_page || pkg.package_url;
    item.cover_verified = true;
    item.cover_width = size.width;
    item.cover_height = size.height;
    item.cover_kind = 'official-publisher-package';

    covers[item.slug] = {
      local: relative,
      source: pkg.source_page || pkg.package_url,
      source_package: pkg.package_url,
      package_member: pkg.member,
      publisher: pkg.publisher || null,
      resolved_at: new Date().toISOString(),
      width: size.width,
      height: size.height,
      quality: 'verified-official-publisher-art',
      identity_verified: true
    };
    resolved += 1;
  } catch (error) {
    failures.push({ slug: item.slug, error: error.message });
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

write(rankingPath, data);
write(coversPath, covers);
console.log(JSON.stringify({ resolved, failures }, null, 2));
if (failures.length) process.exitCode = 1;

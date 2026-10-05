// Stamps a content hash onto every app file URL (stylesheets, the entry module, and an
// import map covering all modules) so browsers fetch fresh code right after a deploy.
// GitHub Pages lets browsers cache files for 10 minutes; versioned URLs sidestep that.
// Run before committing: `npm run stamp`.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const list = (dir, ext) => readdirSync(join(root, dir)).filter((f) => f.endsWith(ext)).map((f) => `${dir}/${f}`);
const modules = ['config.js', ...list('js', '.js')];
const styles = list('css', '.css');

const hash = createHash('sha256');
for (const file of [...modules, ...styles].sort()) hash.update(file).update(readFileSync(join(root, file)));
const version = hash.digest('hex').slice(0, 10);

const importMap = JSON.stringify({ imports: Object.fromEntries(modules.map((m) => [`./${m}`, `./${m}?v=${version}`])) }, null, 2)
  .split('\n')
  .join('\n  ');

for (const page of ['index.html', 'styles.html']) {
  const file = join(root, page);
  let html = readFileSync(file, 'utf8');
  html = html.replace(/(href="css\/[\w-]+\.css)(\?v=\w+)?"/g, `$1?v=${version}"`);
  html = html.replace(/(src="js\/[\w-]+\.js)(\?v=\w+)?"/g, `$1?v=${version}"`);
  const block = `<script type="importmap" data-stamp>\n  ${importMap}\n  </script>`;
  if (html.includes('data-stamp')) html = html.replace(/<script type="importmap" data-stamp>[\s\S]*?<\/script>/, block);
  else html = html.replace(/\n(\s*)<script type="module"/, `\n$1${block}\n$1<script type="module"`);
  writeFileSync(file, html);
}

console.log(`Stamped ${modules.length} modules and ${styles.length} stylesheets as v=${version}`);

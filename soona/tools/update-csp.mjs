// Recalcule l'empreinte SHA-256 du script inline et la met à jour dans la CSP de index.html.
// À lancer après toute modification du <script> :  node soona/tools/update-csp.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const file = new URL('../index.html', import.meta.url);
let src = readFileSync(file, 'utf8');
const m = src.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('Script inline introuvable');
const hash = createHash('sha256').update(m[1], 'utf8').digest('base64');
src = src.replace(/script-src 'sha256-[^']*'/, `script-src 'sha256-${hash}'`);
writeFileSync(file, src);
console.log(`CSP mise à jour : sha256-${hash}`);

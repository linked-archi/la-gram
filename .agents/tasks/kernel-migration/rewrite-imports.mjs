/** L01: run once after installing the qualified kernel archive. Every removal is byte-checked. */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd();
const kernel = resolve(root, '../../platform/linked-archi-kernel');
const task = resolve(root, '.agents/tasks/kernel-migration');
const manifest = JSON.parse(readFileSync(join(kernel, '.agents/tasks/import-from-la-gram/copy-manifest.json')));
const retained = new Set([...manifest.left_in_la_gram, 'src/metamodel-manager/__tests__/basic-fixture.ts']);
const walk = dir => readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(join(dir,e.name)) : [join(dir,e.name)]);
const moved = p => /^(src\/(rdf-engine|metamodel-manager|model-manager)\/|src\/import-export\/model-io\.ts$)/.test(p) && !p.includes('/__tests__/');
const report = { imports: [], retainedTests: [], removed: [] };
const removals = [...['rdf-engine','metamodel-manager','model-manager'].flatMap(d => walk(join(root,'src',d))),join(root,'src/import-export/model-io.ts'),...walk(join(root,'assets')),join(root,'scripts/sync-assets.mjs'),join(root,'src/__tests__/sync-assets.test.ts')].filter(f => !retained.has(relative(root,f)));
// Fail before editing anything if a shared file has drifted or has no destination.
for (const file of removals) {
  const name = relative(root,file), peer = join(kernel,name);
  if (!existsSync(peer)) throw new Error(`No kernel counterpart: ${name}`);
  const bytes = readFileSync(file);
  if (name !== 'src/rdf-engine/__tests__/turtle-writer.test.ts' && !bytes.equals(readFileSync(peer))) throw new Error(`Drift: ${name}`);
  report.removed.push({file:name, destination:`@linked-archi/kernel/${name}`,sha256:createHash('sha256').update(bytes).digest('hex')});
}
for (const file of [...walk(join(root,'src')),...walk(join(root,'tests'))].filter(f => /\.ts$/.test(f) && !removals.includes(f))) {
  const name=relative(root,file), target=retained.has(name)?join(root,'src/__tests__/kernel',file.split('/').at(-1)):file;
  const before=readFileSync(file,'utf8'); let count=0;
  const after=before.replace(/(['"])(\.{1,2}\/[^'"\n]+)\1/g,(match,quote,spec)=>{
    const resolved=resolve(dirname(file),spec), ts=resolved.replace(/\.js$/,'.ts'), rel=relative(root,ts);
    if (moved(rel)) { count++;return quote+'@linked-archi/kernel/'+rel.slice(4).replace(/\.ts$/,'.js')+quote; }
    if (file!==target) {
      let rebased=relative(dirname(target),resolved); if (!rebased.startsWith('.'))rebased='./'+rebased;
      return quote+rebased+quote;
    }
    return match;
  });
  if (count) report.imports.push({file:relative(root,target),count,reason:'Use the same RDF implementation as the workspace; import paths only.'});
  if (file!==target) {mkdirSync(dirname(target),{recursive:true});report.retainedTests.push({from:name,to:relative(root,target)});unlinkSync(file);}
  if (after!==before || file!==target)writeFileSync(target,after);
}
for (const file of removals)unlinkSync(file);
writeFileSync(join(task,'migration-manifest.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({importFiles:report.imports.length,retainedTests:report.retainedTests.length,removed:report.removed.length}));

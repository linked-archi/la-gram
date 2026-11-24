/** KM-12: inventory actual TypeScript imports, including inline import types, for K02 review. */
import ts from 'typescript';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join,relative} from 'node:path';
const root=process.cwd(),modules=new Map();
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
function add(spec,names,file){
  if(!spec.startsWith('@linked-archi/kernel'))return;
  const item=modules.get(spec)??{names:new Set(),files:new Set()};
  names.forEach(n=>item.names.add(n));item.files.add(relative(root,file));modules.set(spec,item);
}
for(const file of walk(join(root,'src')).filter(f=>f.endsWith('.ts')&&!f.includes('/__tests__/'))){
  const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  const visit=node=>{
    if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)){
      const clause=node.importClause,names=[];if(clause?.name)names.push('default');
      const bindings=clause?.namedBindings;
      if(bindings&&ts.isNamedImports(bindings))bindings.elements.forEach(e=>names.push((e.propertyName??e.name).text));
      else if(bindings)names.push('*');
      add(node.moduleSpecifier.text,names,file);
    }
    if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument)&&ts.isStringLiteral(node.argument.literal))add(node.argument.literal.text,[node.qualifier?.getText(source)??'*'],file);
    ts.forEachChild(node,visit);
  };visit(source);
}
let out='# Kernel API used by la-gram\n\nGenerated from application source by `node .agents/tasks/kernel-migration/inventory-api.mjs`.\nIncludes type imports; excludes tests. These are exercised provisional module paths, not a declaration that K02\nis frozen. The package has the same implementations in the browser, desktop and CLI.\n\n| Module | Exported names | Callers |\n|---|---|---|\n';
for(const [name,item] of [...modules].sort(([a],[b])=>a.localeCompare(b)))out+=`| \`${name}\` | ${[...item.names].sort().map(n=>'`'+n+'`').join(', ')} | ${[...item.files].sort().map(f=>'`'+f+'`').join(', ')} |\n`;
writeFileSync('.agents/tasks/kernel-migration/api-usage.md',out);
console.log(`Inventoried ${modules.size} kernel module paths.`);

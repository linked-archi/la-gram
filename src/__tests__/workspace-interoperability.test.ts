/** L01: exercise the actual modeller bootstrap and the workspace's kernel session in both directions. */
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {expect,it} from 'vitest';
import {EditableModel} from '@linked-archi/kernel/workspace';
import {snapshotOf} from '@linked-archi/kernel/model-manager/version-history.js';
import {modelQuads} from '@linked-archi/kernel/model-manager/model-queries.js';
import {createApp} from '../app.js';

const kernel=dirname(createRequire(import.meta.url).resolve('@linked-archi/kernel/package.json'));
const fixture=readFileSync(join(kernel,'fixtures/workspace/archimate4-demo.trig'),'utf8');
const AM='https://meta.linked.archi/archimate4/onto#';

it('edits in workspace, opens and edits in la-gram, and returns without RDF loss',async()=>{
  const workspace=await EditableModel.open(fixture,'demo.trig');
  const iri=workspace.create(AM+'ApplicationComponent','Interoperability service');
  workspace.rename(iri,'Service partagé','fr');
  const other=workspace.contents().elements.find(e=>e.iri!==iri&&e.typeIri===AM+'ApplicationComponent')!.iri;
  workspace.relate(other,iri,workspace.permitted(other,iri)[0].iri);
  const first=workspace.snapshot();
  const app=await createApp({assetMode:'offline',newModel:false,validation:'inline',validationDelayMs:1e9,recordEdits:true});
  try {
    const opened=await app.openModel(workspace.serialize('trig'),'workspace.trig');
    expect(opened.missingMetamodels).toEqual([]);
    expect(snapshotOf(modelQuads(app.components.store))).toEqual(first);
    app.components.elementManager.createElement(AM+'ApplicationComponent',app.session.modelIri!,{label:'Modeller addition',language:'en'});
    const final=snapshotOf(modelQuads(app.components.store));
    expect(final.some(q=>q.includes('Modeller addition'))).toBe(true);
    const returned=await EditableModel.open(app.saveModel('trig').text,'returned.trig');
    expect(returned.snapshot()).toEqual(final);
    expect(returned.normalization).toEqual({added:[],removed:[]});
    expect(returned.values(iri,'http://www.w3.org/2004/02/skos/core#prefLabel').map(v=>v.language).sort()).toEqual(['en','fr']);
    expect(returned.contents().views).toHaveLength(2);
    expect(returned.snapshot().some(q=>q.includes('https://app.linked.archi/workspace/'))).toBe(true);
    expect(returned.snapshot().some(q=>q.includes('https://app.linked.archi/la-gram/'))).toBe(true);
    returned.dispose();
  } finally {
    workspace.dispose();app.components.store.dispose?.();
  }
},30000);

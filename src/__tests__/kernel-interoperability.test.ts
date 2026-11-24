/** L01 consumer contract: the actual modeller preserves the shared canonical RDF fixture. */
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {expect,it} from 'vitest';
import {createApp} from '../app.js';
const kernel=dirname(createRequire(import.meta.url).resolve('@linked-archi/kernel/package.json'));
const fixture=readFileSync(join(kernel,'fixtures/interoperability/archimate4-demo.trig'),'utf8');
it('opens canonical interchange RDF unchanged and retains view identity on a modeller edit',async()=>{
  const app=await createApp({assetMode:'offline',newModel:false,validation:'inline',validationDelayMs:1e9,recordEdits:true});
  try{
    expect((await app.openModel(fixture,'demo.trig')).missingMetamodels).toEqual([]);
    expect(app.saveModel('trig').text).toBe(fixture);
    const views=app.components.viewManager.getViews();
    app.components.elementManager.createElement('https://meta.linked.archi/archimate4/onto#ApplicationComponent',app.session.modelIri!,{label:'Modeller addition',language:'en'});
    expect(app.components.viewManager.getViews()).toEqual(views);
    const result=app.saveModel('trig').text;
    expect(result).toContain('Modeller addition');expect(result).toContain('https://app.linked.archi/la-gram/');
  }finally{app.validation.dispose();app.components.store.dispose?.();}
},30000);

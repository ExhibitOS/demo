import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { verifyNativeInput } from './verify-native-input.mjs';
const h = b => createHash('sha256').update(b).digest('hex');
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'demo-native-input-')); t.after(() => rmSync(dir, {recursive:true,force:true}));
  mkdirSync(join(dir, 'source')); mkdirSync(join(dir, 'web'));
  const index = 'a'.repeat(64), pub = {publicationId:'pub',revisionSha256:'b'.repeat(64),indexSha256:index,manifestSha256:'c'.repeat(64)};
  const platform = {viewerSourceCommit:'d'.repeat(40),viewerSourceTree:'e'.repeat(40),buildId:'f'.repeat(64)};
  const closure = {format:'exhibitos-reference-native-closure-v1',publication:pub,viewer:{sourceCommit:platform.viewerSourceCommit,sourceTree:platform.viewerSourceTree,buildId:platform.buildId},paths:{source:'source',web:'web',webInventory:'web-inventory.json'}};
  writeFileSync(join(dir,'closure.json'),JSON.stringify(closure)); writeFileSync(join(dir,'web-inventory.json'),'{}');
  const paths=['closure.json','web-inventory.json'];
  for(let i=0;i<176;i++){const name=`${i<140?'source':'web'}/f${i}`;writeFileSync(join(dir,name),String(i));paths.push(name)}
  const files=paths.map(path=>{const data=Buffer.from(path==='closure.json'?JSON.stringify(closure):path==='web-inventory.json'?'{}':path.slice(path.lastIndexOf('f')+1));return {path,bytes:data.length,sha256:h(data)}});
  const integrity=JSON.stringify({format:'exhibitos-reference-native-input-v1',indexSha256:index,files});writeFileSync(join(dir,'integrity.json'),integrity);
  return {dir,pub,platform,pin:{indexSha256:index,inventorySha256:h(integrity)}};
}
test('closed pinned native input accepts exact files',t=>{const x=setup(t);assert.equal(verifyNativeInput(x.dir,x.pin,x.pub,x.platform),178)});
test('rejects tampered file, extra input and mismatched viewer identity',t=>{const x=setup(t);writeFileSync(join(x.dir,'source/f0'),'x');assert.throws(()=>verifyNativeInput(x.dir,x.pin,x.pub,x.platform));writeFileSync(join(x.dir,'source/f0'),'0');writeFileSync(join(x.dir,'web/extra'),'x');assert.throws(()=>verifyNativeInput(x.dir,x.pin,x.pub,x.platform));rmSync(join(x.dir,'web/extra'));assert.throws(()=>verifyNativeInput(x.dir,x.pin,x.pub,{...x.platform,viewerSourceCommit:'1'.repeat(40)}));});
test('rejects symlink substitution',t=>{const x=setup(t);rmSync(join(x.dir,'source/f0'));symlinkSync(join(x.dir,'source/f1'),join(x.dir,'source/f0'));assert.throws(()=>verifyNativeInput(x.dir,x.pin,x.pub,x.platform));});

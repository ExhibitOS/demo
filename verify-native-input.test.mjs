import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { nativeInputDirectoryKey, verifyNativeInput } from './verify-native-input.mjs';
const h = b => createHash('sha256').update(b).digest('hex');
function setup(t, count = 178) {
  const dir = mkdtempSync(join(tmpdir(), 'demo-native-input-')); t.after(() => rmSync(dir, {recursive:true,force:true}));
  mkdirSync(join(dir, 'source')); mkdirSync(join(dir, 'web'));
  const index = 'a'.repeat(64), pub = {publicationId:'pub',revisionSha256:'b'.repeat(64),indexSha256:index,manifestSha256:'c'.repeat(64)};
  const platform = {viewerSourceCommit:'d'.repeat(40),viewerSourceTree:'e'.repeat(40),buildId:'f'.repeat(64)};
  const closure = {format:'exhibitos-reference-native-closure-v1',publication:pub,viewer:{sourceCommit:platform.viewerSourceCommit,sourceTree:platform.viewerSourceTree,buildId:platform.buildId},paths:{source:'source',web:'web',webInventory:'web-inventory.json'}};
  writeFileSync(join(dir,'closure.json'),JSON.stringify(closure)); writeFileSync(join(dir,'web-inventory.json'),'{}');
  const paths=['closure.json','web-inventory.json'];
  for(let i=0;i<count-2;i++){const name=`${i<140?'source':'web'}/f${i}`;writeFileSync(join(dir,name),String(i));paths.push(name)}
  const files=paths.map(path=>{const data=Buffer.from(path==='closure.json'?JSON.stringify(closure):path==='web-inventory.json'?'{}':path.slice(path.lastIndexOf('f')+1));return {path,bytes:data.length,sha256:h(data)}});
  const integrity=JSON.stringify({format:'exhibitos-reference-native-input-v1',indexSha256:index,files});writeFileSync(join(dir,'integrity.json'),integrity);
  return {dir,pub,platform,pin:{indexSha256:index,inventorySha256:h(integrity),sourceManifestSha256:pub.manifestSha256}};
}
test('closed pinned native input accepts exact files',t=>{const x=setup(t);assert.equal(verifyNativeInput(x.dir,x.pin,x.pub,x.platform),178)});
test('new inventory size requires an explicit matching pin',t=>{const x=setup(t,179);assert.throws(()=>verifyNativeInput(x.dir,x.pin,x.pub,x.platform));assert.equal(verifyNativeInput(x.dir,{...x.pin,fileCount:179},x.pub,x.platform),179);assert.throws(()=>verifyNativeInput(x.dir,{...x.pin,fileCount:180},x.pub,x.platform));});
test('184-entry inventory requires its exact explicit pin',t=>{const x=setup(t,184);assert.throws(()=>verifyNativeInput(x.dir,x.pin,x.pub,x.platform));assert.throws(()=>verifyNativeInput(x.dir,{...x.pin,fileCount:179},x.pub,x.platform));assert.equal(verifyNativeInput(x.dir,{...x.pin,fileCount:184},x.pub,x.platform),184);assert.throws(()=>verifyNativeInput(x.dir,{...x.pin,fileCount:185},x.pub,x.platform));});
test('188-entry inventory requires its exact explicit pin',t=>{const x=setup(t,188);assert.throws(()=>verifyNativeInput(x.dir,x.pin,x.pub,x.platform));assert.throws(()=>verifyNativeInput(x.dir,{...x.pin,fileCount:184},x.pub,x.platform));assert.equal(verifyNativeInput(x.dir,{...x.pin,fileCount:188},x.pub,x.platform),188);assert.throws(()=>verifyNativeInput(x.dir,{...x.pin,fileCount:189},x.pub,x.platform));});
test('189-entry inventory requires its exact explicit pin',t=>{const x=setup(t,189);assert.throws(()=>verifyNativeInput(x.dir,x.pin,x.pub,x.platform));assert.throws(()=>verifyNativeInput(x.dir,{...x.pin,fileCount:188},x.pub,x.platform));assert.equal(verifyNativeInput(x.dir,{...x.pin,fileCount:189},x.pub,x.platform),189);assert.throws(()=>verifyNativeInput(x.dir,{...x.pin,fileCount:190},x.pub,x.platform));});
test('rejects tampered file, extra input and mismatched viewer identity',t=>{const x=setup(t);writeFileSync(join(x.dir,'source/f0'),'x');assert.throws(()=>verifyNativeInput(x.dir,x.pin,x.pub,x.platform));writeFileSync(join(x.dir,'source/f0'),'0');writeFileSync(join(x.dir,'web/extra'),'x');assert.throws(()=>verifyNativeInput(x.dir,x.pin,x.pub,x.platform));rmSync(join(x.dir,'web/extra'));assert.throws(()=>verifyNativeInput(x.dir,x.pin,x.pub,{...x.platform,viewerSourceCommit:'1'.repeat(40)}));});
test('rejects symlink substitution',t=>{const x=setup(t);rmSync(join(x.dir,'source/f0'));symlinkSync(join(x.dir,'source/f1'),join(x.dir,'source/f0'));assert.throws(()=>verifyNativeInput(x.dir,x.pin,x.pub,x.platform));});
test('separately pins raw native and hosted manifest identities',t=>{const x=setup(t);const hosted={...x.pub,manifestSha256:'1'.repeat(64)};assert.equal(verifyNativeInput(x.dir,x.pin,hosted,x.platform),178);assert.throws(()=>verifyNativeInput(x.dir,{...x.pin,sourceManifestSha256:'2'.repeat(64)},hosted,x.platform));const missing={...x.pin};delete missing.sourceManifestSha256;assert.throws(()=>verifyNativeInput(x.dir,missing,hosted,x.platform));});

test('native bundle paths preserve legacy index and require exact inventory-keyed identity',()=>{const a='a'.repeat(64), b='b'.repeat(64);assert.equal(nativeInputDirectoryKey({indexSha256:a,inventorySha256:b}),a);assert.equal(nativeInputDirectoryKey({indexSha256:a,inventorySha256:b,inputId:b}),b);assert.throws(()=>nativeInputDirectoryKey({indexSha256:a,inventorySha256:b,inputId:'../bad'}));assert.throws(()=>nativeInputDirectoryKey({indexSha256:a,inventorySha256:b,inputId:a}));});

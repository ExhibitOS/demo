import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyStaticInput } from './verify-static-input.mjs';
const hash = x => createHash('sha256').update(x).digest('hex');
function fixture(t) {
 const dir=mkdtempSync(join(tmpdir(),'static-input-')); t.after(()=>rmSync(dir,{recursive:true,force:true})); mkdirSync(join(dir,'output'));
 const index=Buffer.from('{}'), ih=hash(index), pub={publicationId:'p',revisionSha256:'a'.repeat(64),indexSha256:ih,priorCopyBaseCount:0};
 const manifest=Buffer.from(JSON.stringify({publicationId:pub.publicationId,revisionSha256:pub.revisionSha256,indexSha256:ih}));pub.manifestSha256=hash(manifest);
 const platform={viewerSourceCommit:'1'.repeat(40),viewerSourceTree:'2'.repeat(40),lockSha256:'3'.repeat(64),buildId:'4'.repeat(64)};
 const files={};const rows=[];function add(name,bytes){writeFileSync(join(dir,'output',name),bytes);files[name]=hash(bytes);rows.push({path:'output/'+name,bytes:bytes.length,sha256:files[name]});}
 add('static-publication-index.json',index);add('static-export-manifest.json',manifest);for(let i=0;i<151;i++)add('file'+i,Buffer.from('test'+i));
 const inv={format:'exhibitos-reference-static-input-v1',publication:{publicationId:pub.publicationId,revisionSha256:pub.revisionSha256,indexSha256:ih,nativeManifestSha256:'5'.repeat(64),manifestSha256:pub.manifestSha256},viewer:{sourceCommit:platform.viewerSourceCommit,sourceTree:platform.viewerSourceTree,lockSha256:platform.lockSha256,buildId:platform.buildId},files:rows};
 function pin(){const b=Buffer.from(JSON.stringify(inv));writeFileSync(join(dir,'integrity.json'),b);return {inputId:hash(b),inventorySha256:hash(b),fileCount:153,nativeManifestSha256:'5'.repeat(64)};}
 return {dir,inv,pin,lock:{files,platform,publication:pub}};
}
test('accepts exact complete static output',t=>{const x=fixture(t);assert.equal(verifyStaticInput(x.dir,x.pin(),x.lock),153)});
test('rejects changes, extra files, and links',t=>{const x=fixture(t),p=x.pin();writeFileSync(join(x.dir,'output','file0'),'tampered');assert.throws(()=>verifyStaticInput(x.dir,p,x.lock));writeFileSync(join(x.dir,'output','file0'),'test0');writeFileSync(join(x.dir,'output','extra'),'x');assert.throws(()=>verifyStaticInput(x.dir,p,x.lock));rmSync(join(x.dir,'output','extra'));rmSync(join(x.dir,'output','file0'));symlinkSync('file1',join(x.dir,'output','file0'));assert.throws(()=>verifyStaticInput(x.dir,p,x.lock));});
test('rejects unsafe paths, wrong identity, duplicate and wrong count',t=>{const x=fixture(t);x.inv.files[0].path='output/../escape';assert.throws(()=>verifyStaticInput(x.dir,x.pin(),x.lock));x.inv.files[0].path='output/static-publication-index.json';x.inv.publication.revisionSha256='bad';assert.throws(()=>verifyStaticInput(x.dir,x.pin(),x.lock));x.inv.publication.revisionSha256=x.lock.publication.revisionSha256;x.inv.files[0]=x.inv.files[1];assert.throws(()=>verifyStaticInput(x.dir,x.pin(),x.lock));x.inv.files.pop();assert.throws(()=>verifyStaticInput(x.dir,x.pin(),x.lock));});

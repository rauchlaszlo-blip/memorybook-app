import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {digestStream,preservationHash,preservationFingerprint} from '../scripts/verify-previous-pilot';

test('previous-pilot verifier hashes streamed bytes exactly and rejects oversized streams',async()=>{
  const parts=[Buffer.from('fictional original '),Buffer.from([0,1,2,255])];
  const stream=()=>new ReadableStream<Uint8Array>({start(controller){for(const part of parts)controller.enqueue(part);controller.close();}});
  assert.deepEqual(await digestStream(stream()),{bytes:23,sha256:createHash('sha256').update(Buffer.concat(parts)).digest('hex')});
  await assert.rejects(digestStream(stream(),2),/BINARY_LIMIT_EXCEEDED/);
});
test('previous-pilot fingerprints retain source values and frozen references without raw data',()=>{
  assert.equal(preservationHash({b:2,a:1}),preservationHash({a:1,b:2}));
  const entry={role:'owner' as const,path:'/api/wedding/books/fixture',kind:'json' as const,status:200,sha256:preservationHash({privateText:'fictional'}),bytes:27};
  assert.notEqual(preservationFingerprint([entry],[]),preservationFingerprint([{...entry,sha256:preservationHash({privateText:'changed'})}],[]));
  assert.notEqual(preservationFingerprint([entry],[]),preservationFingerprint([{...entry,status:404,sha256:null}],[]));
  assert.equal(JSON.stringify(entry).includes('fictional'),false);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {collectionDataFingerprint,verifyArchiveOriginals} from '../scripts/backup-collection-owner-https';
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
test('owner emergency backup checks retained original bytes and refuses unexpected archive originals',()=>{
  const bytes=Buffer.from('harmless fictional original'),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',groupId='fictional-group';
  const data={book:{id:'fictional-book'},settings:{},legacy:{},sessions:[{groupId,files:[{id,state:'ready',sha256:hash(bytes),byteLength:bytes.length,originalUrl:'/scoped/original',provenance:'original_bytes_verified'}]}]};
  const name=`originals/${hash(groupId).slice(0,24)}/${id}.jpg`,archive=new Map([[name,bytes]]);
  assert.equal(verifyArchiveOriginals(data,archive)[0].sha256,hash(bytes));
  assert.throws(()=>verifyArchiveOriginals(data,new Map([[name,Buffer.from('changed')]])),/ARCHIVE_ORIGINAL_DIGEST_MISMATCH/);
  assert.throws(()=>verifyArchiveOriginals(data,new Map()),/ARCHIVE_ORIGINAL_SET_MISMATCH/);
  assert.throws(()=>verifyArchiveOriginals(data,new Map([...archive,['originals/unexpected.bin',bytes]])),/ARCHIVE_UNEXPECTED_ORIGINAL/);
  const exported={...data,exportedAt:'2026-11-28T00:00:00Z',format:'memorybook-collection'};assert.equal(collectionDataFingerprint(exported),collectionDataFingerprint(data));
  assert.notEqual(collectionDataFingerprint({...data,settings:{revision:1}}),collectionDataFingerprint(data));
});

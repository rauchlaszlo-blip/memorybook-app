import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionZip} from '../server/collection/archive';
import {collectionPilotOrigin,parseStoredZip,validateCollectionHttpsConfig} from '../scripts/verify-collection-https';
test('HTTPS helper accepts only the exact new pilot and does not accept old/prod/general URLs',()=>{
  const config={baseUrl:collectionPilotOrigin,guestToken:'fictional-guest',ownerTrialKey:'a'.repeat(43),bookId:'fictional-book'};
  assert.equal(validateCollectionHttpsConfig(config).baseUrl,collectionPilotOrigin);
  for(const baseUrl of ['https://memorybook-wedding-text-pilot-ukd0.onrender.com','https://example.com',collectionPilotOrigin+'/'])assert.throws(()=>validateCollectionHttpsConfig({...config,baseUrl}),/EXACT_NEW_PILOT_CONFIG_REQUIRED/);
  assert.throws(()=>validateCollectionHttpsConfig({...config,unknown:'x'}),/CONFIG_INVALID/);
});
test('HTTPS archive inspection verifies stored entry bytes, CRC and complete directory bounds',()=>{
  const content=Buffer.from('Árvíztűrő synthetic original'),zip=createCollectionZip([{name:'manifest.json',bytes:Buffer.from('{}')},{name:'originals/fixture/file.jpg',bytes:content}]);
  assert.deepEqual(parseStoredZip(zip).get('originals/fixture/file.jpg'),content);
  const damaged=Buffer.from(zip),where=damaged.indexOf(content);damaged[where]^=1;assert.throws(()=>parseStoredZip(damaged),/ZIP_CRC_INVALID/);
  const badDirectory=Buffer.from(zip),directory=badDirectory.readUInt32LE(badDirectory.length-6);badDirectory[directory+16]^=1;assert.throws(()=>parseStoredZip(badDirectory),/ZIP_CENTRAL_MISMATCH/);
  assert.throws(()=>parseStoredZip(zip.subarray(0,zip.length-1)),/ZIP_END_INVALID/);
});

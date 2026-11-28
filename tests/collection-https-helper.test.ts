import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createCollectionZip} from '../server/collection/archive';
import {assertOriginalsPreserved,collectionHttpsRun,collectionPilotOrigin,parseStoredZip,validateCollectionHttpsConfig} from '../scripts/verify-collection-https';
test('HTTPS helper accepts only the exact new pilot and does not accept old/prod/general URLs',()=>{
  const config={baseUrl:collectionPilotOrigin,guestToken:'fictional-guest',ownerTrialKey:'a'.repeat(43),bookId:'fictional-book'};
  assert.equal(validateCollectionHttpsConfig(config).baseUrl,collectionPilotOrigin);
  for(const baseUrl of ['https://memorybook-wedding-text-pilot-ukd0.onrender.com','https://example.com',collectionPilotOrigin+'/'])assert.throws(()=>validateCollectionHttpsConfig({...config,baseUrl}),/EXACT_NEW_PILOT_CONFIG_REQUIRED/);
  assert.throws(()=>validateCollectionHttpsConfig({...config,unknown:'x'}),/CONFIG_INVALID/);
  assert.equal(validateCollectionHttpsConfig({...config,expiresAt:'2027-01-31T22:59:59Z'}).expiresAt,'2027-01-31T22:59:59Z');
  assert.throws(()=>validateCollectionHttpsConfig({...config,expiresAt:'2027-02-30T22:59:59Z'}),/CONFIG_EXPIRY_INVALID/);
});
test('migration verification uses a separate stable run and never redirects the old checkpoint path',()=>{
  const path=resolve('test-results/collection-release-20261127/release.local.json');
  assert.equal(collectionHttpsRun(path,['--run']).dir,resolve('test-results/collection-release-20261127'));
  const options=['--run','--new-fictional-submission=migration-20261128','--expected-owner-expiry=2027-01-31T22:59:59Z'],first=collectionHttpsRun(path,options);
  assert.equal(first.dir,resolve('test-results/collection-release-20261127/runs/migration-20261128'));assert.deepEqual(collectionHttpsRun(path,options),first);
  for(const label of ['../original','migration/second','x','migration_20261128','Migration-20261128',''])assert.throws(()=>collectionHttpsRun(path,['--new-fictional-submission='+label]),/INVALID_FICTIONAL_RUN_LABEL/);
  assert.throws(()=>collectionHttpsRun(path,['--run','--prepare-only']),/CONFLICTING_RUN_MODES/);
  assert.throws(()=>collectionHttpsRun(path,['--reset']),/UNKNOWN_RUN_OPTION/);
  assert.throws(()=>collectionHttpsRun(path,['--new-fictional-submission=first-test','--new-fictional-submission=second-test']),/DUPLICATE_RUN_OPTION/);
  assert.throws(()=>collectionHttpsRun(path,['--expected-owner-expiry=2027-01-31T23:59:59+01:00']),/EXPECTED_OWNER_EXPIRY_INVALID/);
});
test('retained original byte manifest detects changes, removals and duplicates independent of row order',()=>{
  const photo={groupId:'old-page',fileId:'photo',sha256:'a'.repeat(64),byteLength:123},video={groupId:'old-page',fileId:'video',sha256:'b'.repeat(64),byteLength:456},before=[photo,video];
  assert.doesNotThrow(()=>assertOriginalsPreserved(before,[video,photo]));
  for(const after of [[photo],[photo,photo],[photo,{...video,sha256:'c'.repeat(64)}],[photo,{...video,byteLength:457}],[photo,{...video,groupId:'other-page'}]])assert.throws(()=>assertOriginalsPreserved(before,after),/PREEXISTING_ORIGINALS_CHANGED/);
});
test('HTTPS archive inspection verifies stored entry bytes, CRC and complete directory bounds',()=>{
  const content=Buffer.from('Árvíztűrő synthetic original'),zip=createCollectionZip([{name:'manifest.json',bytes:Buffer.from('{}')},{name:'originals/fixture/file.jpg',bytes:content}]);
  assert.deepEqual(parseStoredZip(zip).get('originals/fixture/file.jpg'),content);
  const damaged=Buffer.from(zip),where=damaged.indexOf(content);damaged[where]^=1;assert.throws(()=>parseStoredZip(damaged),/ZIP_CRC_INVALID/);
  const badDirectory=Buffer.from(zip),directory=badDirectory.readUInt32LE(badDirectory.length-6);badDirectory[directory+16]^=1;assert.throws(()=>parseStoredZip(badDirectory),/ZIP_CENTRAL_MISMATCH/);
  assert.throws(()=>parseStoredZip(zip.subarray(0,zip.length-1)),/ZIP_END_INVALID/);
});

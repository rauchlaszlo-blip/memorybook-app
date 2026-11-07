import { request } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
// Operator only. Uses an existing private operator session; never a buyer session.
const {origin}=JSON.parse(await readFile('test-results/internet-verification.json','utf8'));
assert.match(origin,/^https:\/\/memorybook-wedding-text-pilot-[a-z0-9]+\.onrender\.com$/);
const client=await request.newContext({storageState:'test-results/internet-owner-state.local',extraHTTPHeaders:{Origin:origin}});
try{
  const [action='issue',value,extra]=process.argv.slice(2);
  let result;
  if(action==='issue')result=await client.post(origin+'/api/shop/operator/codes',{data:{days:7}});
  else if(action==='revoke')result=await client.post(origin+'/api/shop/operator/codes/'+encodeURIComponent(value||'')+'/revoke',{data:{}});
  else if(action==='mail')result=await client.get(origin+'/api/shop/operator/mail?email='+encodeURIComponent(value||''));
  else if(action==='clock')result=await client.post(origin+'/api/shop/operator/clock',{data:{bookId:value,now:extra==='clear'?null:extra}});
  else throw new Error('Use issue | revoke CODE_ID | mail TEST_EMAIL | clock BOOK_ID ISO_TIME_OR_clear');
  if(!result.ok())throw new Error('Operator action rejected: HTTP '+result.status());
  const filename=action==='issue'?'pilot-test-code.local':action==='mail'?'pilot-test-mail.local':'pilot-operator-result.local';
  await writeFile(filename,JSON.stringify(await result.json(),null,2),{mode:0o600});
  console.log('Operator result saved to ignored '+filename+'. No email or invoice sent.');
}finally{await client.dispose();}

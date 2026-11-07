import { webkit, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const {origin}=JSON.parse(await readFile('test-results/internet-verification.json','utf8'));
assert.match(origin,/^https:\/\/memorybook-wedding-text-pilot-[a-z0-9]+\.onrender\.com$/);
const browser=await webkit.launch();
try {
  const ctx=await browser.newContext({locale:'hu-HU',viewport:{width:390,height:844}});
  const email='password-'+randomUUID()+'@example.test';
  const rejected=await ctx.request.post(origin+'/api/auth/sign-up/email',{headers:{Origin:origin},data:{name:'Fiktív',email,password:'aaa'}});
  assert.equal(rejected.status(),400);assert.equal((await rejected.json()).code,'PASSWORD_TOO_SHORT');
  const p=await ctx.newPage();await p.goto(origin+'/pilot/account');
  await p.getByRole('button',{name:'Új fiókot hozok létre',exact:true}).click();
  await p.getByLabel('E-mail',{exact:true}).fill(email);
  const password=p.getByLabel('Jelszó',{exact:true});await expect(password).toHaveAttribute('minlength','4');
  await expect(p.getByText('Legalább 4 karakter. Nincs kötelező karakterösszetétel.',{exact:true})).toBeVisible();
  await password.pressSequentially('aaa');await p.getByRole('button',{name:'Regisztrálok',exact:true}).click();
  assert.equal(await password.evaluate((e:HTMLInputElement)=>e.validity.tooShort),true);
  await password.pressSequentially('a');await p.getByRole('button',{name:'Regisztrálok',exact:true}).click();
  await expect(p.getByRole('heading',{name:'Saját könyveim',exact:true})).toBeVisible();
  for(let i=0;i<2;i++){
    await p.getByRole('button',{name:'Kilépés',exact:true}).click();await p.goto(origin+'/pilot/account');
    await p.getByLabel('E-mail',{exact:true}).fill(email);await p.getByLabel('Jelszó',{exact:true}).fill('aaaa');
    await p.getByRole('button',{name:'Belépek',exact:true}).click();await expect(p.getByRole('heading',{name:'Saját könyveim',exact:true})).toBeVisible();
  }
  const existing=JSON.parse(await readFile('test-results/commerce-account.local','utf8'));
  const longer=await ctx.request.post(origin+'/api/auth/sign-in/email',{headers:{Origin:origin},data:existing});assert.equal(longer.status(),200);
  console.log('PASS on deployed pilot: backend and browser reject 3; 4 identical letters register and log in twice; existing longer password still works; UI minimum and copy agree.');
} finally {await browser.close();}

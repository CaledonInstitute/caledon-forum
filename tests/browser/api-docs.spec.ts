import { test, expect } from '@playwright/test';

test('Swagger is public and sends Bearer keys without persisting authorization',async({page,request})=>{
  const specification=await request.get('/api/openapi.json');
  expect(specification.ok()).toBe(true);expect(await specification.json()).toMatchObject({openapi:'3.1.0',security:[{ApiKey:[]}]});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  // Browser transport stub verifies Swagger's header and memory-only storage;
  // unit and workerd tests cover actual key validation against D1.
  const token='cfk_'+'a'.repeat(64);
  const headers:(string|undefined)[]=[];
  await page.route('**/api/v1/me',async route=>{
    const authorization=route.request().headers()['authorization'];headers.push(authorization);
    await route.fulfill({status:authorization===`Bearer ${token}`?200:401,contentType:'application/json',body:JSON.stringify(authorization?{username:'test_user',name:'Test User'}:{error:'A valid Bearer API key is required.'})});
  });
  await page.goto('/api/docs');
  await expect(page.getByRole('heading',{name:'Caledon Forum API',exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Authorize',exact:true}).click();
  await page.locator('.auth-container input').fill(token);
  await page.getByRole('button',{name:'Apply credentials',exact:true}).click();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  const operation=page.locator('.opblock-get').filter({has:page.locator('[data-path="/me"]')});
  await operation.locator('.opblock-summary').click();
  await operation.getByRole('button',{name:'Try it out'}).click();
  await operation.getByRole('button',{name:'Execute',exact:true}).click();
  await expect.poll(()=>headers.length).toBe(1);expect(headers[0]).toBe(`Bearer ${token}`);
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain(token);
  await page.screenshot({path:'artifacts/api-docs-desktop.png',fullPage:true});
  await page.evaluate(()=>history.replaceState(null,'','/api/docs'));
  await page.reload();
  const reloaded=page.locator('.opblock-get').filter({has:page.locator('[data-path="/me"]')});
  await reloaded.locator('.opblock-summary').click();
  await reloaded.getByRole('button',{name:'Try it out'}).click();await reloaded.getByRole('button',{name:'Execute',exact:true}).click();
  await expect.poll(()=>headers.length).toBe(2);expect(headers[1]).toBeUndefined();expect(errors).toEqual([]);
});

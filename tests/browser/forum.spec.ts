import {test,expect} from '@playwright/test';
import {load} from 'cheerio';
let notebookPath:string,mediaPath:string;
test.beforeAll(async({request})=>{
 const response=await request.get('/');const $=load(await response.text());
 notebookPath=$('#post-qa-notebook .post-time').attr('href')!;mediaPath=$('#post-qa-media .post-time').attr('href')!;
 expect(notebookPath).toMatch(/^\/p\/[1-9][0-9]*$/);expect(mediaPath).toMatch(/^\/p\/[1-9][0-9]*$/);
});
test('feed, navigation and anonymous interaction',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/');await expect(page.getByRole('heading',{name:'Home',exact:true})).toBeVisible();await expect(page.locator('#post-qa-notebook')).toContainText('research notebook');
 await page.screenshot({path:'artifacts/feed-desktop.png',fullPage:true});
 await page.locator('#post-qa-notebook [data-like]').click();await expect(page).toHaveURL(/\/login$/);await expect(page.getByText('Sign-in is not available yet.')).toBeVisible();
 expect(errors).toEqual([]);
});
test('public thread has SSR content, metadata and crawlable pagination',async({browser})=>{
 const context=await browser.newContext({javaScriptEnabled:false});const page=await context.newPage();await page.goto(notebookPath+'?utm_source=test');
 expect(await page.title()).toContain('research notebook');await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content',/research notebook/);await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content','summary_large_image');await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href','http://localhost:4321'+notebookPath);
 await expect(page.locator('#post-qa-notebook pre')).toContainText('notebook.add');const schemas=await page.locator('script[type="application/ld+json"]').allTextContents();expect(schemas.some(s=>JSON.parse(s)['@type']==='DiscussionForumPosting')).toBe(true);
 await expect(page.locator('#post-qa-reply-00 .reply-details')).toHaveCount(1);await page.getByRole('link',{name:'Load more'}).click();await expect(page.locator('#post-qa-reply-22')).toBeVisible();await context.close();
});
test('post content and empty space open the detail page',async({page})=>{
 for(const area of ['content','space']){
  await page.goto('/');
  const post=page.locator('#post-qa-notebook');
  if(area==='content')await post.locator('.post-content p').first().click();
  else await post.click({position:{x:5,y:5}});
  await expect(page).toHaveURL(notebookPath);
  await expect(page.getByRole('heading',{name:'Thread',exact:true})).toBeVisible();
  await expect(page.locator('#post-qa-notebook')).not.toHaveAttribute('data-post-url');
 }
});
test('post interactions and text selection keep their behavior',async({page})=>{
 await page.goto('/');
 const post=page.locator('#post-qa-notebook');
 await post.locator('summary').click();
 await expect(post.locator('details.more')).toHaveAttribute('open','');
 await expect(page).toHaveURL('/');
 await post.locator('summary').click();
 await post.locator('.post-content p').first().evaluate(element=>{
  const range=document.createRange();range.selectNodeContents(element);
  const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);
 });
 await post.dispatchEvent('click');
 await expect(page).toHaveURL('/');
 await page.evaluate(()=>window.getSelection()?.removeAllRanges());
 await post.locator('.identity strong').click();
 await expect(page).toHaveURL('/qa_caledon');
});
test('search and profile show server-rendered results',async({page})=>{
 await page.goto('/search');await page.getByLabel('Search posts and people').fill('research notebook');await page.getByRole('button',{name:'Search',exact:true}).click();await expect(page.locator('#post-qa-notebook')).toBeVisible();
 await page.goto('/qa_caledon');await expect(page.getByRole('heading',{name:'Caledon QA',exact:true})).toBeVisible();expect(await page.locator('script[type="application/ld+json"]').last().textContent()).toContain('ProfilePage');
});
test('mobile has no horizontal overflow and exposes keyboard navigation',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto(notebookPath);await expect(page.getByRole('navigation',{name:'Mobile navigation'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'artifacts/thread-mobile.png',fullPage:true});
 await page.goto('/');await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to content'})).toBeFocused();
});
test('index directives, missing content and generated PNG cards',async({request})=>{
 const robots=await request.get('/robots.txt');expect(await robots.text()).toContain('Sitemap: http://localhost:4321/sitemap.xml');
 const sitemap=await request.get('/sitemap.xml');expect(await sitemap.text()).toContain(notebookPath);expect(await sitemap.text()).not.toContain('/login');
 expect((await request.get('/thread/nonexistent')).status()).toBe(404);expect((await request.get('/search')).headers()['x-robots-tag']).toBe('noindex');
 const card=await request.get(`/api/og/${notebookPath.split('/').pop()}.png`);expect(card.ok()).toBe(true);expect(card.headers()['content-type']).toContain('image/png');const bytes=await card.body();expect(bytes.readUInt32BE(16)).toBe(1200);expect(bytes.readUInt32BE(20)).toBe(630);
 const fallback=await request.get('/social.png');expect(bytes.equals(await fallback.body())).toBe(false);
});
test('external images and click-loaded YouTube',async({page,request})=>{
 await page.route('https://www.youtube-nocookie.com/**',route=>route.fulfill({contentType:'text/html',body:'<html><body>Test player</body></html>'}));
 await page.goto(mediaPath);await expect(page.locator('#post-qa-media .post-content img')).toHaveAttribute('src','/api/media/qa-image');
 await expect(page.locator('iframe')).toHaveCount(0);await page.getByRole('button',{name:'Play YouTube preview test fixture'}).click();await expect(page.locator('iframe')).toHaveAttribute('src','https://www.youtube-nocookie.com/embed/jNQXAC9IVRw');
 const image=await request.get('/api/media/qa-image');expect(image.ok()).toBe(true);expect(image.headers()['content-type']).toMatch(/^image\/(png|jpeg|webp|gif)/);
 expect((await request.get('/api/media/arbitrary')).status()).toBe(404);
});
test('old routes are removed and profile URLs are canonical',async({request})=>{
 for(const path of ['/u/qa_caledon','/thread/qa-notebook','/p/qa-notebook','/api/og/qa-notebook.png'])expect((await request.get(path,{maxRedirects:0})).status()).toBe(404);
 const profile=await request.get('/qa_caledon?utm_source=test');expect(profile.status()).toBe(200);const $=load(await profile.text());expect($('link[rel=canonical]').attr('href')).toBe('http://localhost:4321/qa_caledon');
 expect((await request.get('/missing_profile')).status()).toBe(404);expect((await request.get('/constructor')).status()).toBe(404);
 const sitemap=await (await request.get('/sitemap.xml')).text();expect(sitemap).not.toContain('/thread/');expect(sitemap).not.toContain('/u/qa_caledon');expect(sitemap).toContain('/qa_caledon');
});

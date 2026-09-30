// All API requests use fixtures; this test does not change employee data.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
const user={id:1,employee_id:7,role_name:'Employee',email:'test@example.invalid',employee_name_ar:'موظف تجريبي',allowed_pages:['portal']};
const data={currentUser:user,employees:[{id:7,name_ar:'موظف تجريبي',country:'Egypt'}],attendance:[],requests:[],requestApprovals:[],leaveBalances:[],leaveTypes:[],employeeLeaveTypes:[],holidays:[],payrollItems:[],payrollAllowanceLines:[]};
for(const width of [360,390,768,1440]){
 const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',r=>r.fulfill({json:r.request().url().includes('/api/auth')?{authenticated:true,user}:r.request().url().includes('/api/hr')?data:{notifications:[],unread:0}}));
 await page.goto(process.env.RUNTIME_BASE_URL || 'http://localhost:3000');await page.locator('.portal-attendance').waitFor();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width}`);
 if(width<761){
  for(const label of ['إجازاتي','طلباتي','الرئيسية']){await page.locator('.employee-mobile-nav').getByRole('button',{name:label,exact:true}).click();await page.waitForTimeout(150);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${label}`);}
  await page.locator('.employee-mobile-nav').getByRole('button',{name:'المزيد'}).click();assert(await page.locator('.sidebar.open').isVisible());await page.locator('.mobile-close').click();await page.waitForTimeout(400);
 }
 await page.screenshot({path:`output/sanad-mobile-${width}.png`,fullPage:true});assert.deepEqual(errors,[]);console.log(`PASS ${width}px: navigation, no overflow, no runtime errors`);await context.close();
}
const offlineContext=await browser.newContext();
const offlinePage=await offlineContext.newPage();
await offlinePage.route('**/api/**',r=>r.fulfill({json:{authenticated:false}}));
await offlinePage.goto(process.env.RUNTIME_BASE_URL || 'http://localhost:3000');
await offlinePage.evaluate(()=>navigator.serviceWorker.ready);
await offlinePage.waitForFunction(()=>!!navigator.serviceWorker.controller);
const manifest=await offlinePage.evaluate(()=>fetch('/manifest.webmanifest').then(r=>r.json()));
assert.equal(manifest.display,'standalone');
for(const icon of manifest.icons){assert.equal((await offlineContext.request.get(new URL(icon.src,offlinePage.url()).href)).status(),200);}
await offlineContext.setOffline(true);await offlinePage.reload();
assert(await offlinePage.getByText('تحتاج اتصال بالإنترنت').isVisible());
console.log('PASS PWA manifest, icons and offline fallback');
await offlineContext.close();
await browser.close();


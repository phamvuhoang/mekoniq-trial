// Run only against the isolated smoke-review environment (1891).
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
 const out = path.resolve(process.env.BRAND_EVIDENCE || '.brand-evidence');
 fs.mkdirSync(out, {recursive:true});
 const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM});
 const results=[];
 try {
 if (process.env.BRAND_ARMED_ONLY) {
  const checks=[];
  for (const [route,id] of [['setup.html?tab=backup','reset'],['map.html','defaults']]) {
   const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});
   await page.goto('http://127.0.0.1:1891/'+route);
   await page.waitForFunction(()=>App.site && App.state);
   await page.addScriptTag({path:process.env.AXE_MODULE || require.resolve('axe-core/axe.min.js')});
   await page.evaluate(()=>{window.brandSent=[];const original=send;send=o=>{brandSent.push(o);original(o);};});
   const button=page.locator('#'+id);
   await button.click();
   const state=await button.evaluate(e=>({armed:e.classList.contains('armed'),label:e.textContent.trim(),fg:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor}));
   const resets=await page.evaluate(()=>brandSent.filter(o=>['siteReset','mapReset'].includes(o.type)));
   await page.screenshot({path:path.join(out,'final-'+id+'-armed.png'),fullPage:true});
   const violations=await page.evaluate(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations.filter(v=>['critical','serious'].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})));
   checks.push({id,state,resets,violations});
   await page.close(); // Dismiss the confirmation without its second click.
  }
  fs.writeFileSync(path.join(out,'final-armed.json'),JSON.stringify(checks,null,2));
  for (const check of checks) {
   assert.ok(check.state.armed,check.id+' first click arms confirmation');
   assert.match(check.state.label,/Chạm lần nữa/,check.id+' confirmation label');
   assert.deepEqual(check.resets,[],check.id+' first click sends no reset');
   assert.equal(check.state.fg,'rgb(7, 29, 33)',check.id+' on-danger foreground');
   assert.equal(check.state.bg,'rgb(255, 170, 160)',check.id+' danger background');
   assert.deepEqual(check.violations,[],check.id+' armed accessibility');
  }
  console.log('BRAND_ARMED_OK: 2 genuine first-click confirmations; no reset commands; WCAG serious/critical 0');
  return;
 }
 for (const [width,height] of (process.env.BRAND_STATES_ONLY ? [] : [[1280,800],[800,1280],[390,844]])) {
  for (const lang of ['vi','en']) {
   const context=await browser.newContext({viewport:{width,height}, reducedMotion:'reduce'});
   await context.addInitScript(l => {localStorage.setItem('mekoniq.lang',l);},lang);
   const page=await context.newPage();
   for (const screen of ['index.html','setup.html','station.html?role=bep','robot.html?robot=R1','table.html?t=T01','map.html']) {
    await page.goto('http://127.0.0.1:1891/'+screen);
    await page.waitForTimeout(550);
    if(await page.locator('#start').isVisible().catch(()=>false)) await page.locator('#start').click();
    await page.evaluate(()=>document.fonts.ready);
    const name=screen.split('.')[0]+'-'+lang+'-'+width;
    const layout=await page.evaluate(()=>({bg:getComputedStyle(document.body).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth,font:document.fonts.check('16px "Be Vietnam Pro"'),acts:[...document.querySelectorAll('.act')].filter(e=>e.getBoundingClientRect().height).map(e=>({h:e.getBoundingClientRect().height,required:location.pathname.endsWith('table.html')?56:e.classList.contains('dark')?60:parseInt(getComputedStyle(e).getPropertyValue('--act-h'))||72}))}));
    await page.addScriptTag({path:process.env.AXE_MODULE || require.resolve('axe-core/axe.min.js')});
    const violations=await page.evaluate(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations.filter(v=>['critical','serious'].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})));
    results.push({name,layout,violations});
    await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
   }
   await context.close();
  }
 }
 if (results.length) fs.writeFileSync(path.join(out,'matrix.json'),JSON.stringify(results,null,2));
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
 const page=await context.newPage();
 await page.goto('http://127.0.0.1:1891/table.html?t=T01');
 await page.waitForFunction(()=>document.querySelector('#lang button[data-lang=en]'));
 await page.locator('#lang button[data-lang=en]').click();
 assert.equal(await page.locator('html').getAttribute('lang'),'en');
 await page.reload();
 await page.waitForFunction(()=>document.documentElement.lang==='en');
 await page.keyboard.press('Tab');
 assert.ok(await page.evaluate(()=>document.activeElement!==document.body),'keyboard focus');
 const icon=await page.locator('.identity img').boundingBox();
 assert.equal(Math.round(icon.width),40,'compact original icon');
 await context.setOffline(true);
 await page.evaluate(()=>Transport.ws.close());
 await page.waitForFunction(()=>{const el=document.querySelector('#offline');return !el.hidden&&el.textContent.trim().length>0;});
 assert.equal(await page.locator('#offline').evaluate(e=>getComputedStyle(e).opacity),'1');
 await page.screenshot({path:path.join(out,'guest-en-offline-390.png'),fullPage:true});
 await page.emulateMedia({media:'print'});
 assert.equal(await page.locator('body').evaluate(e=>getComputedStyle(e).color),'rgb(20, 48, 52)');
 await context.close();
 const active=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce'});
 const control=await active.newPage();
 const scan=async(name)=>{
  await control.addScriptTag({path:process.env.AXE_MODULE || require.resolve('axe-core/axe.min.js')});
  const findings=await control.evaluate(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations.filter(v=>['critical','serious'].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
  await control.screenshot({path:path.join(out,name+'.png'),fullPage:true});
  fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify(findings,null,2));
  assert.deepEqual(findings,[],name+' accessibility');
 };
 await control.goto('http://127.0.0.1:1891/setup.html?tab=guest');
 await control.waitForFunction(()=>typeof D!=='undefined'&&D);
 await control.locator('[data-feat="order"]').uncheck();
 await control.locator('[data-feat="order"]').check();
 assert.equal(await control.locator('#save').isEnabled(),true);
 await scan('setup-enabled-save');
 await control.locator('#save').click();
 await control.waitForFunction(()=>!saving&&!dirty);
 await control.evaluate(()=>send({type:'reset',by:'brand-smoke'}));
 await control.waitForFunction(()=>App.state.robots.every(r=>r.phase==='idle'));
 await control.goto('http://127.0.0.1:1891/robot.html?robot=R1');
 await control.locator('#start').click();
 await control.locator('[data-act="order"]').click();
 await control.locator('[data-ot="T05"]').click();
 await control.locator('[data-qty="pho"][data-d="1"]').click();
 await scan('robot-order-active');
 // Actual create command on isolated simulator; no render state is fabricated.
 await control.evaluate(()=>{send({type:'create',kind:'deliver',from:'kitchen',tables:['T01'],robot:'R1'});});
 await control.waitForFunction(()=>document.querySelector('.tray:not(.on)'));
 await scan('robot-trays-active');
 await active.close();
 fs.writeFileSync(path.join(out,'states.json'),JSON.stringify({guestLanguageSwitchAndReload:true,keyboardFocus:true,compactIcon:true,offlineLabel:true,printInk:true},null,2));
 for(const r of results) {
  assert.equal(r.layout.overflow,false,r.name+' overflow');
  assert.equal(r.layout.bg,'rgb(7, 29, 33)',r.name+' dark background');
  assert.ok(r.layout.font,r.name+' local font');
  for(const a of r.layout.acts) assert.ok(a.h>=a.required,r.name+' command target');
  assert.deepEqual(r.violations,[],r.name+' accessibility');
 }
 console.log('BRAND_BROWSER_OK: '+results.length+' screenshots, dark theme, local fonts, command targets and WCAG scans');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

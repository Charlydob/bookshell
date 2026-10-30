const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');fs.mkdirSync('outputs',{recursive:true});fs.mkdirSync('work',{recursive:true});
(async()=>{const browser=await chromium.launch({...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),headless:true});try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage();
 await context.route('**/*',r=>['127.0.0.1','cdn.jsdelivr.net'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 await page.goto('http://127.0.0.1:19442/#view-habits');await page.locator('#deviceTransitionNotice').waitFor({timeout:30000});
 assert.equal(await page.locator('#loginBox').count(),0);
 await page.locator('#deviceTransitionNotice').click();await page.locator('#devicePairCode').waitFor();
 const code=await page.evaluate(async()=>await(await fetch('/qa/bootstrap')).json());await page.locator('#devicePairCode').fill(code.code);await page.locator('#devicePairSubmit').click();
 await page.waitForFunction(async()=>{const s=await(await fetch('/auth/status')).json();return s.mode==='observe'&&s.paired;});await page.reload();
 await page.waitForFunction(()=>!document.querySelector('#loginBox')&&!document.querySelector('#deviceTransitionNotice'));
 const result={passed:1,scenario:'Observe preserves existing access and exposes device pairing; enrollment survives reload'};
 fs.writeFileSync('outputs/JARVIS2-Fase2-transicion.json',JSON.stringify(result,null,2));console.log(result);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
import sys, asyncio, time
from playwright.async_api import async_playwright
url = sys.argv[1]; T = float(sys.argv[2]) if len(sys.argv)>2 else 120
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=1, is_mobile=True, has_touch=True,
            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
        pg = await ctx.new_page()
        await pg.add_init_script('''
          const T0 = performance.now();
          addEventListener('DOMContentLoaded', () => {
            const el = document.getElementById('ld-msg');
            if (el) new MutationObserver(() => console.log('STEP', ((performance.now()-T0)/1000).toFixed(1)+'s', el.textContent)).observe(el, {childList:true, characterData:true, subtree:true});
          });
          let lf = performance.now(); let n=0;
          const raf = () => { const t = performance.now(); if (t - lf > 3000) console.log('LONGFRAME', ((t-lf)/1000).toFixed(1)+'s at', ((t-T0)/1000).toFixed(1)); lf = t; n++; requestAnimationFrame(raf); };
          requestAnimationFrame(raf);
        ''')
        pg.on('console', lambda m: print(f'[{m.type}] {m.text}'[:400], flush=True))
        pg.on('pageerror', lambda e: print(f'[pageerror] {e}', flush=True))
        t0=time.time()
        await pg.goto(url, wait_until='domcontentloaded', timeout=60000)
        last=''
        while time.time()-t0 < T:
            await asyncio.sleep(2)
            try:
                s = await asyncio.wait_for(pg.evaluate("(document.getElementById('ld-msg')||{}).textContent+' | '+((document.getElementById('enter')||{}).disabled)"), 20)
            except Exception as e:
                s = 'eval timeout'
            if s!=last: print(f'{time.time()-t0:5.1f}s {s}', flush=True); last=s
            if 'false' in s: break
        await pg.screenshot(path='/tmp/probe.png', timeout=60000)
        await b.close()
asyncio.run(main())

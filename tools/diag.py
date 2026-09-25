# diag: python tools/diag.py  -> prints first errors & boot timings
import asyncio, sys
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=1, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        logs=[]
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text[:600]}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto('http://localhost:4173/?qa=1', wait_until='load')
        for i in range(90):
            await asyncio.sleep(2)
            if any('context lost' in l.lower() or 'VALIDATE' in l or 'pageerror' in l for l in logs): break
            try:
                d = await pg.evaluate("document.getElementById('enter')?.disabled")
                if d is False: break
            except: pass
        for l in logs[:40]: print(l)
        await b.close()
asyncio.run(main())

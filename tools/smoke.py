# Headless smoke test: boots the hub, enters, opens a sheet; reports page errors + failed/404 requests.
#   python3 tools/smoke.py URL
import sys, asyncio
from playwright.async_api import async_playwright
URL = sys.argv[1]
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
        '--renderer-process-limit=1', '--in-process-gpu', '--disable-dev-shm-usage', '--mute-audio']
UA = 'Mozilla/5.0 (Linux; Android 16; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        ctx = await b.new_context(viewport={'width': 915, 'height': 412}, is_mobile=True, has_touch=True, user_agent=UA, reduced_motion='reduce')
        pg = await ctx.new_page()
        errs, bad, logs = [], [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
        pg.on('requestfailed', lambda r: bad.append(f'FAILED {r.url}'))
        pg.on('response', lambda r: bad.append(f'{r.status} {r.url}') if r.status >= 400 else None)
        sep = '&' if '?' in URL else '?'
        await pg.goto(URL + sep + 'qa=0.2&fps=1&nocompile&noshadow&norefl', wait_until='load')
        ok = True
        try:
            await pg.wait_for_selector('#enter:not([disabled])', timeout=240000)
            await pg.evaluate("Element.prototype.requestFullscreen = undefined; document.getElementById('enter').click()")
            await pg.wait_for_timeout(3000)
            await pg.evaluate("window.__imatore.openItem(6, 0)")
            await pg.wait_for_timeout(800)
            hero = await pg.evaluate("getComputedStyle(document.querySelector('.d-hero')).backgroundImage")
            print('hero:', hero)
            await pg.screenshot(path='/tmp/smoke.png')
        except Exception as e:
            ok = False; print('BOOT FAIL', e, await pg.evaluate("document.getElementById('ld-msg')?.textContent"))
        print('pageerrors:', errs[:8]); print('bad requests:', bad[:15]); print('console:', logs[:8])
        print('RESULT', 'OK' if ok and not errs and not bad else 'NG')
        await b.close()
asyncio.run(main())

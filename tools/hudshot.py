# HUD state screenshots (HTML layer incl. compass / zone banner / prompt) after running JS snippets.
#   QA_PORT=4174 python3 tools/hudshot.py OUTPREFIX "js1" "js2" ...   -> OUTPREFIX_0.png ...
import os, sys, asyncio
from playwright.async_api import async_playwright
PORT = os.environ.get('QA_PORT', '4173')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
        '--renderer-process-limit=1', '--in-process-gpu', '--disable-dev-shm-usage', '--mute-audio']
UA = 'Mozilla/5.0 (Linux; Android 16; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'
async def main():
    pre, views = sys.argv[1], sys.argv[2:]
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        ctx = await b.new_context(viewport={'width': 915, 'height': 412}, is_mobile=True, has_touch=True, user_agent=UA)
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(f'http://localhost:{PORT}/?qa=0.3&fps=3&nocompile&noshadow&norefl', wait_until='load')
        await pg.wait_for_selector('#enter:not([disabled])', timeout=240000)
        await pg.evaluate("Element.prototype.requestFullscreen = undefined; document.getElementById('enter').click()")
        # wait until the intro fly-in has finished (it is frame-rate bound under SwiftShader)
        await pg.wait_for_function('window.__imatore && window.__imatore.introDone && window.__imatore.introDone()', timeout=120000)
        for i, js in enumerate(views):
            await pg.evaluate(js); await pg.wait_for_timeout(2500)
            await pg.screenshot(path=f'{pre}_{i}.png'); print('shot', i, flush=True)
        print('pageerrors:', errs[:5]); await b.close()
asyncio.run(main())

# UI/HUD layout check on a landscape Android phone (full-page screenshot incl. HTML overlays).
#   python3 tools/uishot.py OUTPREFIX
# Produces: _loader.png, _hud.png, _detail.png, _guide.png, _portrait.png
# 3D is rendered at a tiny QA scale (?qa=0.2) — this harness is about the HTML layer.
import sys, asyncio
from playwright.async_api import async_playwright
pre = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ui'
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
        '--renderer-process-limit=1', '--in-process-gpu', '--disable-dev-shm-usage', '--mute-audio']
UA = 'Mozilla/5.0 (Linux; Android 16; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        # Galaxy S25 Ultra-ish landscape CSS viewport
        ctx = await b.new_context(viewport={'width': 915, 'height': 412}, device_scale_factor=1, is_mobile=True, has_touch=True, user_agent=UA)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:4173/?qa=0.2&fps=1&nocompile&noshadow&norefl', wait_until='load')
        await pg.wait_for_selector('#enter:not([disabled])', timeout=240000)
        await pg.screenshot(path=f'{pre}_loader.png')
        await pg.evaluate("Element.prototype.requestFullscreen = undefined; document.getElementById('enter').click()")
        await pg.wait_for_timeout(5000)
        await pg.screenshot(path=f'{pre}_hud.png')
        await pg.evaluate("window.__imatore.openItem(6, 0)")
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f'{pre}_detail.png')
        await pg.evaluate("document.getElementById('detail').classList.add('hidden'); document.getElementById('btn-guide').click()")
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path=f'{pre}_guide.png')
        await pg.set_viewport_size({'width': 412, 'height': 915})
        await pg.wait_for_timeout(1200)
        await pg.screenshot(path=f'{pre}_portrait.png')
        print('pageerrors:', errs[:5])
        await b.close()
asyncio.run(main())

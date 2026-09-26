# Multi-view snapshot in one browser session (landscape Android phone, 844x390).
#   python3 tools/multisnap.py OUTPREFIX "js1" "js2" ... [--q=1] [--flags=nocompile] [--wait=3]
# each js is evaluated after entering; the canvas is grabbed via toDataURL -> OUTPREFIX_N.png
# Also saves OUTPREFIX_hud.png (full page incl. HTML HUD) for the first view when --hud is given.
import sys, asyncio, time, base64
from playwright.async_api import async_playwright
args = [a for a in sys.argv[1:] if not a.startswith('--')]
opt = {a.split('=')[0][2:]: (a.split('=', 1)[1] if '=' in a else '1') for a in sys.argv[1:] if a.startswith('--')}
prefix, views = args[0], args[1:] or ['']
qa = opt.get('q', '1'); flags = opt.get('flags', 'nocompile'); wait = float(opt.get('wait', '3'))
W, H = (390, 844) if 'port' in opt else (844, 390)
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
        '--renderer-process-limit=1', '--in-process-gpu', '--disable-extensions', '--js-flags=--max-old-space-size=900', '--disable-dev-shm-usage', '--mute-audio']
GRAB = """(()=>{const e=window.__imatore?.engine; if(!e) return null; e.render(performance.now()/1000); return e.renderer.domElement.toDataURL('image/png');})()"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        ctx = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1, is_mobile=True, has_touch=True,
            user_agent='Mozilla/5.0 (Linux; Android 16; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36')
        pg = await ctx.new_page()
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text[:240]}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        t0 = time.time()
        await pg.goto(f'http://localhost:4173/?qa={qa}&fps=1&{flags}', wait_until='load')
        await pg.wait_for_selector('#enter:not([disabled])', timeout=240000)
        if 'loader' in opt:
            await pg.screenshot(path=f'{prefix}_loader.png')
        await pg.evaluate("Element.prototype.requestFullscreen = undefined; document.getElementById('enter').click()")
        await pg.wait_for_timeout(4500)
        for i, js in enumerate(views):
            if js: await pg.evaluate(js)
            await pg.wait_for_timeout(int(wait * 1000))
            d = await pg.evaluate(GRAB)
            if d: open(f'{prefix}_{i}.png', 'wb').write(base64.b64decode(d.split(',')[1]))
            if 'hud' in opt and i == 0:
                try: await pg.screenshot(path=f'{prefix}_hud.png', timeout=60000)
                except Exception as e: logs.append('hud shot failed ' + str(e)[:80])
            print(f'view {i} {time.time()-t0:.0f}s', flush=True)
        info = await pg.evaluate("(()=>{const i=window.__imatore.engine.renderer.info; return JSON.stringify({geos:i.memory.geometries,tex:i.memory.textures,prog:i.programs?.length})})()")
        print(info)
        bad = [l for l in logs if any(k in l for k in ('error', 'Error', 'INVALID', 'Lost', 'warn'))]
        for l in bad[:15]: print(l)
        await b.close()
asyncio.run(main())

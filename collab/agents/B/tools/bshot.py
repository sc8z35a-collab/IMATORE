# Agent B multi-view shooter. Injects stub DOM for missing map/settings nodes (pre A-001 fix builds)
#   python3 bshot.py OUTPREFIX "js1" "js2" ... [--port=4175] [--q=0.5] [--flags=nocompile] [--wait=3]
import sys, asyncio, time, base64
from playwright.async_api import async_playwright
args = [a for a in sys.argv[1:] if not a.startswith('--')]
opt = {a.split('=')[0][2:]: (a.split('=', 1)[1] if '=' in a else '1') for a in sys.argv[1:] if a.startswith('--')}
prefix, views = args[0], args[1:] or ['']
qa = opt.get('q', '0.5'); flags = opt.get('flags', 'nocompile'); wait = float(opt.get('wait', '3')); port = opt.get('port', '4175')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
        '--renderer-process-limit=1', '--in-process-gpu', '--disable-extensions', '--js-flags=--max-old-space-size=900', '--disable-dev-shm-usage', '--mute-audio']
STUB = """document.addEventListener('DOMContentLoaded',()=>{for(const [id,tag] of [['map','div'],['map-canvas','canvas'],['settings','div'],['settings-body','div'],['btn-map','button'],['btn-settings','button'],['ld-settings','button']]){if(!document.getElementById(id)){const e=document.createElement(tag);e.id=id;e.className='hidden';e.style.display='none';document.body.appendChild(e);}}});"""
GRAB = """(()=>{const e=window.__imatore?.engine; if(!e) return null; e.render(performance.now()/1000); return e.renderer.domElement.toDataURL('image/png');})()"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        ctx = await b.new_context(viewport={'width': 844, 'height': 390}, device_scale_factor=1, is_mobile=True, has_touch=True,
            user_agent='Mozilla/5.0 (Linux; Android 16; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36')
        await ctx.add_init_script(STUB)
        pg = await ctx.new_page()
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text[:240]}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        pg.on('response', lambda r: logs.append(f'[{r.status}] {r.url}') if r.status >= 400 else None)
        t0 = time.time()
        await pg.goto(f'http://localhost:{port}/{opt.get("path","")}?qa={qa}&fps=1&{flags}', wait_until='load')
        await pg.wait_for_selector('#enter:not([disabled])', timeout=240000)
        await pg.evaluate("Element.prototype.requestFullscreen = undefined; document.getElementById('enter').click()")
        await pg.wait_for_timeout(4500)
        for i, js in enumerate(views):
            if js:
                r = await pg.evaluate("async()=>{window.T=window.T||await import(\x27three\x27).catch(()=>null);return await ("+js+")}" if "T." in js else js)
                if r is not None: print('js->', str(r)[:400])
            await pg.wait_for_timeout(int(wait * 1000))
            d = await pg.evaluate(GRAB)
            if d: open(f'{prefix}_{i}.png', 'wb').write(base64.b64decode(d.split(',')[1]))
            print(f'view {i} {time.time()-t0:.0f}s', flush=True)
        info = await pg.evaluate("(()=>{const i=window.__imatore.engine.renderer.info; return JSON.stringify({calls:i.render.calls,tris:i.render.triangles,geos:i.memory.geometries,tex:i.memory.textures})})()")
        print(info)
        bad = [l for l in logs if any(k in l for k in ('error', 'Error', 'INVALID', 'Lost', 'warn', '[4'))]
        for l in bad[:20]: print(l)
        await b.close()
asyncio.run(main())

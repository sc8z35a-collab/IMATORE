# Low-memory canvas snapshot: renders one frame and grabs the WebGL canvas via toDataURL (avoids CDP compositor capture).
#   python3 tools/snap.py out.png "[js after enter]" [wait_s] [--port] [--q=0.35] [--flags=noshadow&norefl]
import sys, asyncio, time, base64
from playwright.async_api import async_playwright
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/s.png'
js = sys.argv[2] if len(sys.argv) > 2 else ''
wait = float(sys.argv[3]) if len(sys.argv) > 3 else 4
port = '--port' in sys.argv
qa = next((a.split('=')[1] for a in sys.argv if a.startswith('--q=')), '0.35')
flags = next((a.split('=',1)[1] for a in sys.argv if a.startswith('--flags=')), '')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
        '--renderer-process-limit=1', '--disable-extensions', '--js-flags=--max-old-space-size=420', '--disable-dev-shm-usage']
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        vp = {'width': 390, 'height': 844} if port else {'width': 844, 'height': 390}
        ctx = await b.new_context(viewport=vp, device_scale_factor=1, is_mobile=True, has_touch=True,
            user_agent='Mozilla/5.0 (Linux; Android 16; Pixel 11 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36')
        pg = await ctx.new_page()
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text[:300]}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        t0 = time.time()
        await pg.goto(f'http://localhost:4173/?qa={qa}&fps=1&{flags}', wait_until='load')
        try:
            await pg.wait_for_selector('#enter:not([disabled])', timeout=200000)
        except Exception as e:
            logs.append('enter never enabled: ' + str(e))
        await pg.evaluate("document.getElementById('enter').click()")
        await pg.wait_for_timeout(4500)
        if js:
            await pg.evaluate(js)
        await pg.wait_for_timeout(int(wait * 1000))
        data = await pg.evaluate("""(()=>{const e=window.__imatore?.engine; if(!e) return null; e.render(performance.now()/1000); 
          const src=e.renderer.domElement; const c=document.createElement('canvas'); c.width=src.width; c.height=src.height; const g=c.getContext('2d'); g.drawImage(src,0,0);
          // overlay HUD boxes roughly for layout check
          return c.toDataURL('image/png');})()""")
        info = await pg.evaluate("(()=>{const e=window.__imatore?.engine; if(!e) return 'no engine'; const i=e.renderer.info; return JSON.stringify({calls:i.render.calls,tris:i.render.triangles,geos:i.memory.geometries,tex:i.memory.textures,dpr:e.dpr})})()")
        if data:
            open(out, 'wb').write(base64.b64decode(data.split(',')[1]))
        print(f'{time.time()-t0:.0f}s', info)
        for l in logs[-30:]:
            if 'vite' not in l: print(l)
        await b.close()
asyncio.run(main())

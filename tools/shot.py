# Headless mobile screenshot harness: python tools/shot.py out.png [js to run after enter] [wait]
import sys, asyncio
from playwright.async_api import async_playwright
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/s.png'
js = sys.argv[2] if len(sys.argv) > 2 else ''
wait = float(sys.argv[3]) if len(sys.argv) > 3 else 5
land = '--land' in sys.argv
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'])
        vp = {'width': 844, 'height': 390} if land else {'width': 390, 'height': 844}
        ctx = await b.new_context(viewport=vp, device_scale_factor=1, is_mobile=True, has_touch=True,
            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
        pg = await ctx.new_page()
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        await pg.goto('http://localhost:5173/?qa=1', wait_until='load')
        try:
            await pg.wait_for_selector('#enter:not([disabled])', timeout=180000)
        except Exception as e:
            logs.append('enter never enabled: ' + str(e))
        await pg.evaluate("document.getElementById('enter').click()")
        await pg.wait_for_timeout(1000)
        if js:
            await pg.evaluate(js)
        await pg.wait_for_timeout(int(wait * 1000))
        await pg.screenshot(path=out)
        info = await pg.evaluate("(()=>{const e=window.__imatore?.engine; if(!e) return 'no engine'; const i=e.renderer.info; return JSON.stringify({calls:i.render.calls,tris:i.render.triangles,geos:i.memory.geometries,tex:i.memory.textures,dpr:e.dpr})})()")
        print(info)
        for l in logs[-30:]: print(l)
        await b.close()
asyncio.run(main())

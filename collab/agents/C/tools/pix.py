# C pixel probe: setup JS, then for each toggle JS (returns undo fn) render & sample the pixel at a world point.
#   python3 pix.py "<setup>" "<world point js expr returning Vector3>" "name=togglejs" ...
import asyncio, sys, os
from playwright.async_api import async_playwright
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--in-process-gpu', '--disable-dev-shm-usage', '--mute-audio']
PORT = os.environ.get('QA_PORT', '4176')
PIX = '''((tog)=>{const I=window.__imatore,c=I.camera,r=I.engine.renderer; const undo=tog(); I.engine.render(performance.now()/1000);
 const P=(%s); const q=P.project(c); const cv=r.domElement; const x=Math.round((q.x*0.5+0.5)*cv.width), y=Math.round((q.y*0.5+0.5)*cv.height);
 const t=document.createElement('canvas'); t.width=cv.width; t.height=cv.height; const g=t.getContext('2d'); g.drawImage(cv,0,0);
 const d=g.getImageData(x, cv.height-y, 1, 1).data; if(undo) undo(); return [x,y,d[0],d[1],d[2]].join(',');})'''
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        pg = await (await b.new_context(viewport={'width': 844, 'height': 390})).new_page()
        await pg.goto(f'http://localhost:{PORT}/?qa=0.5&fps=1&nocompile', wait_until='load')
        await pg.wait_for_selector('#enter:not([disabled])', timeout=240000)
        await pg.evaluate("Element.prototype.requestFullscreen = undefined; document.getElementById('enter').click()")
        await pg.wait_for_timeout(9000)
        await pg.evaluate(sys.argv[1]); await pg.wait_for_timeout(2500)
        for a in ['none=()=>null'] + sys.argv[3:]:
            k, v = a.split('=', 1)
            print(k, await pg.evaluate((PIX % sys.argv[2]) + '(' + v + ')'))
        await b.close()
asyncio.run(main())

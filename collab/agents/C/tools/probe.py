# C probe: boot (qa=0.3), enter, run JS1 (setup), wait, print result of JS2.
#   python3 collab/agents/C/tools/probe.py "<setup js>" "<expr js>"   (QA_PORT env, default 4176)
import asyncio, sys, os
from playwright.async_api import async_playwright
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--in-process-gpu', '--disable-dev-shm-usage', '--mute-audio']
PORT = os.environ.get('QA_PORT', '4176')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        pg = await (await b.new_context(viewport={'width': 844, 'height': 390})).new_page()
        logs = []; pg.on('console', lambda m: logs.append(m.type + ': ' + m.text[:400])); pg.on('pageerror', lambda e: logs.append('pageerror: ' + str(e)))
        await pg.goto(f'http://localhost:{PORT}/?qa=0.3&fps=1&nocompile', wait_until='load')
        await pg.wait_for_selector('#enter:not([disabled])', timeout=240000)
        await pg.evaluate("Element.prototype.requestFullscreen = undefined; document.getElementById('enter').click()")
        await pg.wait_for_timeout(9000)
        if len(sys.argv) > 1 and sys.argv[1]: await pg.evaluate(sys.argv[1])
        await pg.wait_for_timeout(2500)
        if len(sys.argv) > 2: print(await pg.evaluate(sys.argv[2]))
        for l in logs:
            if 'rror' in l: print(l)
        await b.close()
asyncio.run(main())

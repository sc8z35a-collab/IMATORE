# controls test: simulated multi-touch via CDP Input.dispatchTouchEvent
import asyncio, os
from playwright.async_api import async_playwright
PORT=os.environ.get('QA_PORT','4174')
ARGS=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--renderer-process-limit=1','--in-process-gpu','--disable-dev-shm-usage','--mute-audio']
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(args=ARGS)
    ctx=await b.new_context(viewport={'width':915,'height':412},is_mobile=True,has_touch=True)
    pg=await ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e: errs.append(str(e)))
    await pg.goto(f'http://localhost:{PORT}/?qa=0.2&fps=6&nocompile&noshadow&norefl',wait_until='load')
    await pg.wait_for_selector('#enter:not([disabled])',timeout=240000)
    await pg.evaluate("Element.prototype.requestFullscreen=undefined; document.getElementById('enter').click()")
    await pg.wait_for_function('window.__imatore.introDone()',timeout=120000)
    cdp=await ctx.new_cdp_session(pg)
    T=lambda typ,pts: cdp.send('Input.dispatchTouchEvent',{'type':typ,'touchPoints':pts})
    J=pg.evaluate
    pos=lambda: J("(()=>{const c=window.__imatore.controls;return [+c.pos.x.toFixed(2),+c.pos.z.toFixed(2),+c.yaw.toFixed(3),+c.pitch.toFixed(3),+c.zoom.toFixed(2)]})()")
    print('start',await pos())
    # joystick forward 2s
    await T('touchStart',[{'x':200,'y':300,'id':1}])
    for k in range(10): await T('touchMove',[{'x':200,'y':300-5*k,'id':1}]); await pg.wait_for_timeout(30)
    await pg.wait_for_timeout(2000); print('walked',await pos())
    # second finger looks while walking
    await T('touchStart',[{'x':200,'y':255,'id':1},{'x':700,'y':200,'id':2}])
    for k in range(10): await T('touchMove',[{'x':200,'y':255,'id':1},{'x':700+10*k,'y':200,'id':2}]); await pg.wait_for_timeout(30)
    print('look while walk',await pos())
    # third finger -> pinch with finger 2
    await T('touchStart',[{'x':200,'y':255,'id':1},{'x':790,'y':200,'id':2},{'x':600,'y':200,'id':3}])
    for k in range(8): await T('touchMove',[{'x':200,'y':255,'id':1},{'x':790+10*k,'y':200,'id':2},{'x':600-10*k,'y':200,'id':3}]); await pg.wait_for_timeout(30)
    print('pinch',await pos())
    await T('touchEnd',[]); await pg.wait_for_timeout(600)
    print('released',await pos(), 'joy on?', await J("document.getElementById('joy').classList.contains('on')"))
    # open guide while joystick held, then release on the sheet
    await T('touchStart',[{'x':200,'y':300,'id':5}]); await T('touchMove',[{'x':200,'y':250,'id':5}])
    await J("document.getElementById('btn-guide').click()"); await pg.wait_for_timeout(300)
    await T('touchEnd',[]); await pg.wait_for_timeout(1500)
    a=await pos(); await pg.wait_for_timeout(1500); bpos=await pos()
    print('after guide open + release: still moving?', a[:2]!=bpos[:2], a, bpos)
    print('ERRS',errs[:5]); await b.close()
asyncio.run(main())

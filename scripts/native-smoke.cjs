'use strict';
// Windows-native input check. Uses a test profile and a mocked launch; never
// clicks a point unless WindowFromPoint confirms it belongs to our own pet.
const { _electron: electron } = require('playwright');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const assert = require('node:assert/strict');
const run = promisify(execFile);
const root = path.join(__dirname, '..');
const declarations = `using System;using System.Runtime.InteropServices;public static class PetInput {
 [StructLayout(LayoutKind.Sequential)] public struct Point {public int X,Y;public Point(int x,int y){X=x;Y=y;}}
 [StructLayout(LayoutKind.Sequential)] public struct Rect {public int L,T,R,B;}
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint flag);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint msg,IntPtr w,IntPtr l);
}`;
async function input(handle, point, action) {
  const script = `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition '${declarations.replace(/'/g, "''")}';
  [void][PetInput]::SetThreadDpiAwarenessContext([IntPtr](-4));
  $window=[IntPtr]${handle}; $rect=New-Object PetInput+Rect; [void][PetInput]::GetWindowRect($window,[ref]$rect);
  $dpi=[PetInput]::GetDpiForWindow($window)/96; $x=[int]($rect.L+${point.x}*$dpi);$y=[int]($rect.T+${point.y}*$dpi);
  $old=New-Object PetInput+Point; [void][PetInput]::GetCursorPos([ref]$old);
  try {
    if(![PetInput]::SetCursorPos($x,$y)){throw 'Windows refused to move the cursor'}; Start-Sleep -Milliseconds 350;
    $actual=New-Object PetInput+Point;[void][PetInput]::GetCursorPos([ref]$actual);
    if([Math]::Abs($actual.X-$x) -gt 3 -or [Math]::Abs($actual.Y-$y) -gt 3){throw "Cursor moved outside test point: actual=$($actual.X),$($actual.Y) requested=$x,$y"};
    $hit=[PetInput]::GetAncestor([PetInput]::WindowFromPoint((New-Object PetInput+Point $x,$y)),2);
    ${action === 'transparent' ? `if($hit -eq $window){throw 'Transparent background intercepted native input'}; 'transparent-pass'` : `if($hit -ne $window){throw "Input target is not the pet; refusing to click. x=$x y=$y dpi=$dpi left=$($rect.L) top=$($rect.T) hit=$hit expected=$window"};
    [PetInput]::mouse_event(${action === 'right' ? 8 : 2},0,0,0,[UIntPtr]::Zero);
    ${action === 'drag' ? 'for($i=1;$i -le 8;$i++){[void][PetInput]::SetCursorPos(($x+$i*10),($y+$i*4));Start-Sleep -Milliseconds 60}' : 'Start-Sleep -Milliseconds 80'}
    [PetInput]::mouse_event(${action === 'right' ? 16 : 4},0,0,0,[UIntPtr]::Zero); 'input-sent'`}
  } finally {[void][PetInput]::SetCursorPos($old.X,$old.Y)}`;
  try { return await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15000 }); }
  catch (error) { throw new Error(`Native ${action} input check failed: ${String(error.stderr || error.message).replace(/<[^>]*>/g, ' ').slice(0, 800)}`); }
}
(async () => {
  const env = { ...process.env, LINGLONG_TEST: '1', LINGLONG_TEST_DATA: path.join(root, 'output', 'native-profile') }; delete env.ELECTRON_RUN_AS_NODE;
  const options = { env, args: process.env.LINGLONG_EXECUTABLE ? [] : [root] };
  if (process.env.LINGLONG_EXECUTABLE) options.executablePath = process.env.LINGLONG_EXECUTABLE;
  const app = await electron.launch(options);
  try {
    const page = await app.firstWindow(); await page.waitForFunction(() => document.querySelector('canvas').dataset.action === 'idle');
    const handle = await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0];win.setPosition(150,150);win.show();win.focus();return win.getNativeWindowHandle().readBigUInt64LE().toString(); });
    const point = await page.evaluate(() => {
      const canvas=document.querySelector('canvas'), box=canvas.getBoundingClientRect(), context=canvas.getContext('2d');
      for(let y=240;y<400;y++) for(let x=300;x<340;x++) if(context.getImageData(x,y,1,1).data[3]>240) return {x:box.x+x/640*box.width,y:box.y+y/640*box.height};
      throw new Error('No opaque character point');
    });
    await input(handle, { x: 2, y: 2 }, 'transparent');
    await input(handle, point, 'click');
    await page.waitForFunction(() => document.querySelector('canvas').dataset.action === 'success');
    await page.evaluate(() => window.pet.action('idle'));
    const before=await app.evaluate(({ BrowserWindow })=>BrowserWindow.getAllWindows()[0].getBounds());
    await input(handle,point,'drag');
    const after=await app.evaluate(({ BrowserWindow })=>BrowserWindow.getAllWindows()[0].getBounds());
    assert.ok(after.x>before.x+30,'native drag moved window');
    assert.equal(await page.locator('canvas').getAttribute('data-action'),'idle','drag did not launch');
    let menuRequests=0;
    await page.exposeFunction('countMenuRequest',()=>menuRequests++);
    await page.evaluate(()=>document.addEventListener('contextmenu',()=>window.countMenuRequest()));
    await input(handle,point,'right');
    await page.waitForTimeout(350); assert.equal(menuRequests,1,'right click reaches renderer menu handler');
    await page.keyboard.press('Escape');
    console.log('Windows native input passed: transparent area, left click, drag without launch, right click.');
  } finally {await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

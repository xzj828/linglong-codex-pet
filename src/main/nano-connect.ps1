param(
  [Parameter(Mandatory=$true)][string]$NanoPath,
  [switch]$InspectOnly,
  [switch]$LaunchIfMissing,
  [long]$DeadlineEpochMs = 0
)
$ErrorActionPreference = 'Stop'
$inspectionStage = 40
if ($DeadlineEpochMs -eq 0) {$DeadlineEpochMs=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+30000}
function Test-Deadline {return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $DeadlineEpochMs}
# One short-lived, local helper. No saved privileges, credentials, scheduled
# tasks, node selection, connection toggles, or shell command interpolation.
try {
  if (!(Test-Deadline)) {exit 24}
  $expected = [IO.Path]::GetFullPath($NanoPath)
  if ([IO.Path]::GetFileName($expected) -ine 'nano.exe' -or !(Test-Path -LiteralPath $expected -PathType Leaf)) { exit 22 }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 21 }

  $inspectionStage = 41
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class LinglongNanoMenu {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr data);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MenuBarInfo {
    public int Size; public Rect Rect; public IntPtr Menu; public IntPtr Window; public int Flags;
  }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] static extern bool GetMenuBarInfo(IntPtr hwnd, int objectId, int itemId, ref MenuBarInfo info);
  [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr menu);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetMenuString(IntPtr menu, uint index, StringBuilder label, int max, uint flags);
  [DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr menu, int position);
  [DllImport("user32.dll")] public static extern uint GetMenuState(IntPtr menu, uint position, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; public Point(int x,int y) {X=x;Y=y;} }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd,int command);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hwnd,int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  public static IntPtr FindMainWindow(uint processId) {
    IntPtr result=IntPtr.Zero;
    EnumWindows((hwnd, unused) => {
      uint owner; GetWindowThreadProcessId(hwnd,out owner); if(owner!=processId) return true;
      var name=new StringBuilder(128); GetClassName(hwnd,name,128);
      if(name.ToString()=="FLUTTER_RUNNER_WIN32_WINDOW") {result=hwnd;return false;} return true;
    },IntPtr.Zero); return result;
  }
  public static IntPtr FindMenu(uint processId) {
    IntPtr result=IntPtr.Zero;
    EnumWindows((hwnd, unused) => {
      uint owner; GetWindowThreadProcessId(hwnd, out owner);
      if(owner!=processId || !IsWindowVisible(hwnd)) return true;
      var name=new StringBuilder(64); GetClassName(hwnd,name,64);
      if(name.ToString()!="#32768") return true;
      var info=new MenuBarInfo(); info.Size=Marshal.SizeOf(info);
      if(GetMenuBarInfo(hwnd,-4,0,ref info) && info.Menu!=IntPtr.Zero) { result=info.Menu; return false; }
      return true;
    },IntPtr.Zero);
    return result;
  }
}
'@

  function Read-NanoWindowText([IntPtr]$windowHandle) {
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    [void][LinglongNanoMenu]::SetThreadDpiAwarenessContext([IntPtr](-4))
    $null=[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
    $null=[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType=WindowsRuntime]
    $engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if (!$engine) { return $null }
    $rectangle=New-Object LinglongNanoMenu+Rect
    if (![LinglongNanoMenu]::GetWindowRect($windowHandle,[ref]$rectangle)) { return $null }
    $width=$rectangle.Right-$rectangle.Left; $height=$rectangle.Bottom-$rectangle.Top
    if ($width -lt 200 -or $height -lt 200 -or $width -gt 4000 -or $height -gt 4000) { return $null }
    $bitmap=New-Object Drawing.Bitmap $width,$height,([Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics=[Drawing.Graphics]::FromImage($bitmap)
    $software=$null
    try {
      # Capture just Nano. Pixels and OCR text stay in this process; no file or
      # network upload is created, and account labels are never printed.
      $graphics.CopyFromScreen($rectangle.Left,$rectangle.Top,0,0,$bitmap.Size)
      $area=New-Object Drawing.Rectangle 0,0,$width,$height
      $bits=$bitmap.LockBits($area,[Drawing.Imaging.ImageLockMode]::ReadOnly,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
      try { $pixels=New-Object byte[] ([Math]::Abs($bits.Stride)*$height); [Runtime.InteropServices.Marshal]::Copy($bits.Scan0,$pixels,0,$pixels.Length) } finally {$bitmap.UnlockBits($bits)}
      $buffer=[System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]::AsBuffer($pixels)
      $software=[Windows.Graphics.Imaging.SoftwareBitmap]::CreateCopyFromBuffer($buffer,[Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,$width,$height,[Windows.Graphics.Imaging.BitmapAlphaMode]::Ignore)
      $operation=$engine.RecognizeAsync($software)
      $asTask=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'} | Select-Object -First 1
      $task=$asTask.MakeGenericMethod([Windows.Media.Ocr.OcrResult]).Invoke($null,@($operation))
      if (!$task.Wait(5000)) {return $null}
      return [pscustomobject]@{Rect=$rectangle;Lines=@($task.Result.Lines)}
    } finally {if($software){$software.Dispose()};$graphics.Dispose();$bitmap.Dispose()}
  }

  function Click-NanoText($capture,$line,[IntPtr]$windowHandle,[uint32]$processId) {
    if (!(Test-Deadline)) {return $false}
    if ([LinglongNanoMenu]::GetForegroundWindow() -ne $windowHandle) {return $false}
    $current=New-Object LinglongNanoMenu+Rect
    if (![LinglongNanoMenu]::GetWindowRect($windowHandle,[ref]$current)) {return $false}
    if($current.Left -ne $capture.Rect.Left -or $current.Top -ne $capture.Rect.Top -or $current.Right -ne $capture.Rect.Right -or $current.Bottom -ne $capture.Rect.Bottom) {return $false}
    $left=($line.Words | ForEach-Object {$_.BoundingRect.X} | Measure-Object -Minimum).Minimum
    $right=($line.Words | ForEach-Object {$_.BoundingRect.X+$_.BoundingRect.Width} | Measure-Object -Maximum).Maximum
    $top=($line.Words | ForEach-Object {$_.BoundingRect.Y} | Measure-Object -Minimum).Minimum
    $bottom=($line.Words | ForEach-Object {$_.BoundingRect.Y+$_.BoundingRect.Height} | Measure-Object -Maximum).Maximum
    $point=New-Object LinglongNanoMenu+Point ([int]($current.Left+($left+$right)/2)),([int]($current.Top+($top+$bottom)/2))
    $hit=[LinglongNanoMenu]::WindowFromPoint($point); [uint32]$hitOwner=0
    [void][LinglongNanoMenu]::GetWindowThreadProcessId($hit,[ref]$hitOwner)
    if($hitOwner -ne $processId) {return $false}
    if (!(Test-Deadline)) {return $false}
    [void][LinglongNanoMenu]::SetCursorPos($point.X,$point.Y)
    [LinglongNanoMenu]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
    [LinglongNanoMenu]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
    return $true
  }

  function Invoke-OcrConnect([IntPtr]$windowHandle,[uint32]$processId) {
    if (!(Test-Deadline)) {return 24}
    [void][LinglongNanoMenu]::PostMessage($windowHandle,0x1F,[IntPtr]::Zero,[IntPtr]::Zero)
    [void][LinglongNanoMenu]::PostMessage($windowHandle,1025,[IntPtr]::Zero,[IntPtr]0x202)
    [void][LinglongNanoMenu]::ShowWindowAsync($windowHandle,9)
    Start-Sleep -Milliseconds 400
    [void][LinglongNanoMenu]::SetForegroundWindow($windowHandle)
    $capture=Read-NanoWindowText $windowHandle
    if(!$capture) {return 51}
    # Returning to Home is navigation only. No node rows or settings are used.
    $homeLines=@($capture.Lines | Where-Object {($_.Text -replace '\s','') -cmatch '^(侖?首[页贞]|Home)$'})
    if($homeLines.Count -eq 1) {
      if(!(Click-NanoText $capture $homeLines[0] $windowHandle $processId)) {return 52}
      Start-Sleep -Milliseconds 500
      $capture=Read-NanoWindowText $windowHandle
      if(!$capture) {return 53}
    }
    $connectedLines=@($capture.Lines | Where-Object {($_.Text -replace '\s','') -cmatch '^(已连接|连接成功|Connected|点击断开|断开连接|Disconnect)$'})
    if($connectedLines.Count -gt 0) {return 10}
    $connectLines=@($capture.Lines | Where-Object {($_.Text -replace '\s','') -cmatch '^(点击连接|点按连接|TapToConnect|Connect)$'})
    if($connectLines.Count -ne 1) {return 54}
    if($InspectOnly) {return 0}
    if(Click-NanoText $capture $connectLines[0] $windowHandle $processId) {return 0}
    return 20
  }

  $inspectionStage = 42
  function Find-ExpectedNano {
    return @(Get-Process -Name nano -ErrorAction SilentlyContinue | Where-Object {
      try { [string]::Equals([IO.Path]::GetFullPath($_.MainModule.FileName),$expected,[StringComparison]::OrdinalIgnoreCase) } catch { $false }
    }) | Select-Object -First 1
  }
  $nano = Find-ExpectedNano
  if (!$nano -and $LaunchIfMissing -and !$InspectOnly) {
    if (!(Test-Deadline)) {exit 24}
    Start-Process -FilePath $expected -WorkingDirectory ([IO.Path]::GetDirectoryName($expected)) -WindowStyle Hidden
    for($startupAttempt=0; $startupAttempt -lt 20; $startupAttempt++) {
      if (!(Test-Deadline)) {exit 24}
      Start-Sleep -Milliseconds 300
      $nano = Find-ExpectedNano
      if ($nano -and [LinglongNanoMenu]::FindMainWindow([uint32]$nano.Id) -ne [IntPtr]::Zero) { break }
    }
  }
  if (!$nano) { exit 22 }
  $nano.Refresh()
  $nanoWindow = [LinglongNanoMenu]::FindMainWindow([uint32]$nano.Id)
  if ($nanoWindow -eq [IntPtr]::Zero) { exit 32 }
  [uint32]$ownerId = 0
  [void][LinglongNanoMenu]::GetWindowThreadProcessId($nanoWindow,[ref]$ownerId)
  if ($ownerId -ne $nano.Id) { exit 22 }

  # WM_USER+1 / WM_RBUTTONUP is the installed Flutter tray_manager callback.
  # Read the real native menu; its IDs are never guessed or hardcoded.
  $inspectionStage = 43
  if (![LinglongNanoMenu]::PostMessage($nanoWindow,1025,[IntPtr]::Zero,[IntPtr]0x205)) { exit 33 }
  $menu = [IntPtr]::Zero
  for ($attempt=0; $attempt -lt 16; $attempt++) {
    Start-Sleep -Milliseconds 150
    $menu = [LinglongNanoMenu]::FindMenu([uint32]$nano.Id)
    if ($menu -ne [IntPtr]::Zero) { break }
  }
  if ($menu -eq [IntPtr]::Zero) { exit (Invoke-OcrConnect $nanoWindow ([uint32]$nano.Id)) }
  $inspectionStage = 44
  $connectId = $null
  $disconnectFound = $false
  $count = [LinglongNanoMenu]::GetMenuItemCount($menu)
  for ($index=0; $index -lt $count; $index++) {
    $builder = New-Object Text.StringBuilder 256
    [void][LinglongNanoMenu]::GetMenuString($menu,[uint32]$index,$builder,256,0x400)
    $label = $builder.ToString().Replace('&','').Trim()
    if ($label -cmatch '^(断开|断开连接|Disconnect)$') { $disconnectFound=$true }
    if ($label -cmatch '^(连接|连接网络|Connect|Connect to network)$') {
      $state = [LinglongNanoMenu]::GetMenuState($menu,[uint32]$index,0x400)
      $itemId = [LinglongNanoMenu]::GetMenuItemID($menu,$index)
      # MF_GRAYED, MF_DISABLED, MF_CHECKED and MF_POPUP must all be absent.
      if (($state -band 0x1B) -eq 0 -and $itemId -ne [uint32]::MaxValue) { $connectId=$itemId }
      if (($state -band 8) -ne 0) {$disconnectFound=$true}
    }
  }
  [void][LinglongNanoMenu]::PostMessage($nanoWindow,0x1F,[IntPtr]::Zero,[IntPtr]::Zero)
  if ($InspectOnly) {
    if ($disconnectFound) { exit 10 }
    if ($null -ne $connectId) { exit 0 }
    exit (Invoke-OcrConnect $nanoWindow ([uint32]$nano.Id))
  }
  if ($disconnectFound) { exit 10 }
  if ($null -eq $connectId) { exit (Invoke-OcrConnect $nanoWindow ([uint32]$nano.Id)) }

  # Revalidate process identity after the popup, preventing stale HWND/PID use.
  $nano.Refresh()
  if ($nano.HasExited -or ![string]::Equals([IO.Path]::GetFullPath($nano.MainModule.FileName),$expected,[StringComparison]::OrdinalIgnoreCase)) { exit 22 }
  [void][LinglongNanoMenu]::GetWindowThreadProcessId($nanoWindow,[ref]$ownerId)
  if ($ownerId -ne $nano.Id) { exit 22 }
  Start-Sleep -Milliseconds 100
  if (!(Test-Deadline)) {exit 24}
  if ([LinglongNanoMenu]::PostMessage($nanoWindow,0x111,[IntPtr]([long]$connectId),[IntPtr]::Zero)) { exit 0 }
  exit 20
} catch { if ($InspectOnly) { exit $inspectionStage }; exit 20 }

# Windows 集成说明

## Nano

玲珑从开始菜单快捷方式和标准安装目录查找 `nano.exe`，也接受设置里的本机路径。不会更换节点、读取订阅链接、复制账号令牌或更改系统安全设置。

连接检测组合三项证据：Nano 进程存在；Windows 系统 HTTP 代理端口确实由 Nano 进程监听；通过该代理向 `chatgpt.com:443` 建立证书有效的 TLS 连接。只有三项均满足才显示已连接。检测失败不表示账号已退出，也不把“进程已打开”当作网络连通。

左键流程先检查已有连接，已连接时直接复用；未启动时打开 Nano。自动连接按顺序尝试名称明确的 Windows 无障碍控件、Nano 原生菜单中的明确连接项、Windows 本地 OCR 识别到的“点击连接 / Tap To Connect”文字。不会发送可能断开连接的切换快捷键，不使用固定坐标盲点，不调用“重新连接”。

部分 Nano 版本要求管理员权限，自动连接助手会弹出 Windows 标准 UAC 确认。助手只运行一次，不保存高权限、不创建计划任务、不更改全局安全策略。冷启动时在同一次确认内启动 Nano 并尝试连接；已有连接时跳过助手。40 秒绝对截止时间在助手启动及每次输入之前检查，即使用户很晚才同意 UAC，也不会发生延迟点击。

OCR 在内存中处理 Nano 窗口截图，不保存图片或上传数据。它只接受唯一的明确连接文字，先拒绝“已连接 / Disconnect”等状态；点击前验证前台窗口、窗口尺寸、鼠标目标所属 PID 与 Nano 可执行文件。窗口移动、被其他应用覆盖、文字模糊或出现多个候选都会停止自动点击。助手会尝试导航到“首页”，不会操作节点列表。

**已知限制：**没有安装 Windows OCR 语言包、Nano 页面结构变化、处在“节点选择”等嵌套页面、文字无法识别、或连接文字不属于该版本的可点击区域时，需要回到 Nano 首页手动点击连接。玲珑会提示并继续等待 30 秒，检测成功后自动继续打开 Codex，无需第二次点击桌宠。验证过已有连接的完整启动流程，以及首页“已连接”的 OCR 跳过保护；为保持当前网络，未主动断开 Nano 做冷连接端到端测试。当前实现不声称能绕过 Windows UAC 静默连接。

参考：[Windows OCR 官方文档](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine.recognizeasync)、[Flutter tray_manager 原生实现](https://github.com/leanflutter/tray_manager/blob/v0.5.0/packages/tray_manager/windows/tray_manager_plugin.cpp)。

目前仅验证系统 HTTP 代理模式。TUN、SOCKS-only、PAC 等模式可能实际联网，但不会被误报为已验证的 Nano HTTP 代理。

## Codex 桌面程序

优先使用 Windows 已安装的 `OpenAI.Codex` MSIX 清单生成 `shell:AppsFolder` 应用 ID，避免把命令行 `codex.exe` 误当作桌面程序。设置中的桌面版 exe 路径可以覆盖自动发现。所有后台 PowerShell 均使用隐藏窗口、结构化参数、编码脚本及超时；不经 `cmd.exe` 拼接用户路径。

参考：[官方 Windows 桌面应用文档](https://learn.chatgpt.com/docs/windows/windows-app)。程序身份取自当前机器的已安装清单，不硬编码版本号。

## 剩余额度

额度面板首先启动本机官方 `codex app-server`，完成 `initialize` 握手后只调用 `account/rateLimits/read`。进程最长运行 8 秒，读取结束立即退出，不创建聊天、发送模型请求或消耗任务额度。

实时接口不可用时，读取本机 `.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` 最近最多 12 个文件的末尾最多 1 MiB，只提取 `event_msg/token_count/rate_limits` 统计。不会读取 `auth.json`，不会上传会话内容。结果缓存 30 秒。配额来源、观测时间、窗口长度、重置时间均明确保留；超过 15 分钟或已到重置时间的记录标为旧快照，不自行假设已恢复 100%。

Codex 配额百分比不是 API 账户人民币/美元余额，也不是 Nano 流量余额。没有数据时显示未知；不会根据 token 数估算付费余额，也不会把缺失的第二个额度窗口显示为 100%。

参考：[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)。

## 主进程 API

模块 `src/main/integrations.cjs` 导出：

- `discoverApps(options)`：返回 `nanoPath/codexPath/codexAppId/codexCliPath/nanoInstalled/codexInstalled`。安装发现缓存 5 分钟。
- `connectNano(options)`：返回 `connected/message`，需要操作时包含 `needsInteraction: true`。
- `openCodex(options)`：返回 `opened/message`。
- `getConnectionStatus(options)`：返回安装状态、进程、代理、实际连接状态与 `checkedAt`。
- `getUsage(options)`：返回 `available/primary/secondary/observedAt/source/stale/message`；窗口包含 `usedPercent/remainingPercent/windowMinutes/resetsAt`。

`options` 可含本机 `nanoPath/codexPath`，`force: true` 刷新缓存，`liveUsage: false` 跳过实时配额接口，以及主进程专用的 `onProgress(message)` 回调。路径保存在用户数据目录，不应提交 Git。

`nano-connect.ps1` 必须保留 UTF-8 BOM，以便 Windows PowerShell 5 正确识别中文。安装包通过 `asarUnpack` 保留独立脚本；Windows 不直接执行 ASAR 内的脚本路径。

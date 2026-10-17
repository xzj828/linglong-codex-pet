# 参考资料与实现取舍

核对日期：2026-10-17。下列链接是设计和接口资料；具体功能以本项目代码和实测结果为准。

## OpenAI 官方桌宠

- [Pets · ChatGPT Learn](https://learn.chatgpt.com/docs/pets)：官方桌宠支持桌面浮窗、拖动、尺寸调整、右键隐藏和位置记忆；活动状态包括 Running、Needs input、Ready、Blocked。本项目参考其轻量浮窗、状态反馈和隐藏/恢复交互。
- [Commands · ChatGPT Learn](https://learn.chatgpt.com/docs/reference/commands)：官方保留 `codex://` 深链接；`codex://threads/new` 打开新聊天，`codex://settings` 打开设置。`codex://new` 必须附带至少一个受支持的查询参数，不能把空链接当作可靠启动入口。
- [Codex App Server · ChatGPT Learn](https://learn.chatgpt.com/docs/app-server)：`codex app-server` 提供逐行 JSON-RPC；连接先完成 `initialize` / `initialized` 握手。`account/rateLimits/read` 返回 ChatGPT 额度窗口的 `usedPercent`、`windowDurationMins` 和 `resetsAt`，并可能返回多个额度桶。额度显示应保留获取时间，缺失或失败显示未知，不能把历史 token 用量当成剩余额度。桌宠读取状态不需要发起模型对话，也不需要自行复制登录 token。

## GitHub 桌宠项目

| 项目 | 可参考内容 | 使用边界 |
| --- | --- | --- |
| [LorisYounger/VPet](https://github.com/LorisYounger/VPet) | WPF 桌宠的摸头、投喂、动画状态以及人物工具栏设计 | 代码为 Apache-2.0；角色动画另有授权条款，不能把代码许可证视为素材授权 |
| [coglabss/deskcat](https://github.com/coglabss/deskcat) | Electron 透明置顶窗口、角色区域点击、托盘、开机启动、单实例和状态机拆分 | 仓库明确区分代码与素材许可；本项目不需使用其猫咪素材 |
| [kokoronoka/desktopPet](https://github.com/kokoronoka/desktopPet) | 小幅移动阈值区分点击与拖动、拖动中暂停穿透、断开显示器后的坐标恢复、设置窗口与桌宠窗口分离 | 作为设计参考；没有明确许可证时不直接复制实现 |

## Electron 接口依据

- [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)：透明无边框、置顶、隐藏任务栏，以及 `setIgnoreMouseEvents(true, { forward: true })`；转发移动事件可用于重新检测角色命中区域。`setShape` 目前标为 Windows/Linux 实验接口，采用时需要额外验证。
- [Custom Window Interactions](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions)：CSS 原生拖拽区域会忽略 pointer 事件；同时需要左键点击、右键菜单和拖动的角色区域，适合使用 pointer 位移阈值处理。
- [app](https://www.electronjs.org/docs/latest/api/app)：Windows 开机启动使用 `setLoginItemSettings`；读取状态时应使用相同 `path`、`args`，并注意任务管理器可能禁用启动项。
- [Security](https://www.electronjs.org/docs/latest/tutorial/security)：启用上下文隔离、保持渲染进程无 Node 权限、限制导航和新窗口、校验 IPC 来源与参数，并限制外部链接目标。可执行程序的启动留在主进程，避免把任意 shell 执行能力暴露给网页。
- [Packaging Your Application](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging)：面向用户分发应打包应用；签名是独立发布环节，生成安装包并不自动意味着安装包已签名。

## 建议验收项

1. 左键只触发一次启动流程；拖动不会误触发启动；右键能在连接过程中打开菜单。
2. 切换形象、蹲下、吃饭、摸头后能回到空闲动画；透明处可操作下层窗口。
3. 多显示器和缩放比例变化后角色仍可找回；托盘提供显示、重置位置和退出。
4. Nano 未安装、启动失败、未连接、已连接分别显示真实状态；使用默认节点时不改订阅和节点配置。
5. Codex 额度读取失败时显示原因与更新时间，不把“网络可达”等同于“已登录”或“有额度”。
6. 打包后验证启动、自启动开关、卸载清理和单实例行为；从不向公开仓库提交账户 token、订阅地址、私有日志或机器专属配置。

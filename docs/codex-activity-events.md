# Codex 工作状态事件契约

监测只读取本机已有 rollout 的事件类型、回合标识、时间和结果标记。错误详情、回复正文及工具输出不会传给界面。

| 可靠证据 | `state` | `action` |
| --- | --- | --- |
| `task_started`，或已在进行中的工作事件 | `working` | `busy` |
| `task_complete` 正常结束 | `completed` | `success` |
| `task_complete.error` 包含有效的终态 ErrorEvent | `failed` | `sad` |
| `turn_aborted` | `interrupted` | `sad` |
| 缺少可确认的事件、读取失败、长期无新事件 | `unknown` | `idle` |

`sad` 由界面按形象选择图片：可爱为哭泣，成熟为稍微失落。失败、中断和成功提示默认保留 60 秒，随后回到空闲；新 `task_started` 立即恢复工作。其他会话仍明确工作时，继续显示工作状态与活动数量。

新版本 Codex 将终态错误直接保存在 `task_complete.error`。兼容旧日志时，裸 `error` 仅作为候选：已知回合级错误后出现同一回合的 `task_complete`，且期间没有重试或继续模型工作的证据，才认定失败。以下情况不会误判为任务失败：

- `stream_error`、明确 `willRetry` / `will_retry`、身份验证恢复事件：清除旧错误候选，等待最终结果。
- 后续 `Reasoning` / `AgentMessage` 或 `agent_reasoning`：说明模型继续工作，清除旧错误候选。
- 命令退出码、补丁失败等工具结果：不代表整个回合失败。
- `thread_rollback_failed`、`active_turn_not_steerable`：请求级错误，不更改回合结果。
- 旧日志裸 `error` 的未知分类，或不完整的终态错误结构：显示结果待确认，不猜测失败或成功；有效的 `task_complete.error` 本身已经明确失败，不依赖错误分类。

完成事件不会把同一回合此前已确认的失败/中断改成成功；新回合会清除旧结果。

核对依据：[Codex Core 协议与错误分类](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs)、[官方历史事件还原逻辑与回归测试](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/thread_history.rs)。本机已观察到 `turn_aborted` 及正常 `task_complete`；失败结构依据官方源码和合成回归样本验证，不主动制造真实账户失败。

# NZCP Script Format 2.0 — 完整字段规范

一个 JSON 文件 = 一个完整案件。规范 JSON Schema 见游戏项目 `script-format/case.schema.json`；
校验器见 `scripts/validate_case.py`。本文是**逐字段参考手册**。

---

## 0. 引擎行为摘要（理解字段前先看）

- **文档解锁**：`initial !== false` 的文档开局可见；否则需满足 `requires_findings` **且** `requires_clues` 全部条件（两者都配时取交集）。
- **议题出现**：`requires_clues` 与 `requires_findings` 全部满足时，议题在"推理议题"面板变为"可推理"；之前的锁定态显示"依据不足"。
- **摘录**：文档 block 带 `clue` 字段时渲染为可点击段落，点击后该线索进入线索板。`initial: true` 的线索开局在线索板上，其来源段落显示"已在板上"。
- **关键词圈选（keywords）**：para/quote 带 `clue` + `keywords` 时进入圈选模式——段落渲染为普通文本（无金线无标记），关键信息藏在正文里，玩家须一处一处点中字眼（红笔手绘圈描画动画，逐个圈出）；**圈齐该线索的全部字眼后，线索才收录上线索板**。点在段落但未点中字眼时显示探查提示（按进度显示「已圈几处、还差几处」，不剧透是哪个词）。
- **深挖（dig）**：`dig` 块显示「深入调查」按钮，点击展开 `reveal[]` 隐藏段落（模拟逆转裁判的威慑逼供）。展开状态随存档持久化；未展开的 reveal 内线索不参与目录「新线索」角标统计。
- **隐藏线索（hidden）**：para/quote 加 `"hidden": true` 后渲染与普通段落完全一致（无金线无标记），玩家通读正文时点击才能发现（反馈「（注意到了！）」），同样不参与「新线索」角标统计。
- **推理判定**：玩家选 1-4 张卡（线索或结论）提交；选中集合与 `answer` 集合**完全相等**（顺序无关）即答对。答对产出 `on_correct.finding` 结论卡；答错 `mistakes + 1`，**同一议题第一次答错只显示通用文案「这组材料无法构成有效的推理。」（不给方向，防穷举），第二次起才显示 `on_wrong.message`**（结案同理）。
- **结案**：`required_findings` 全部获得后"结案陈词"按钮激活。提交时校验：`culprit` 正确 **且** 勾选的结论集合包含全部 `required_findings`（可以多选）。错误则 `mistakes + 1`。
- **评分**：`mistakes + hintsUsed` ≤2 → S；≤5 → A；≤8 → B；否则 C。
- **存档**：localStorage 自动存档（摘录/解题/结案时），刷新可继续。

---

## 1. 顶层结构

```json
{
  "format_version": "2.0",
  "case": { ... },
  "characters": [ ... ],
  "documents": [ ... ],
  "clues": [ ... ],
  "questions": [ ... ],
  "findings": [ ... ],
  "accusation": { ... }
}
```

七个顶层键均为必需。`format_version` 必须为字符串 `"2.0"`。

---

## 2. `case` — 案件元数据

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✔ | 案件唯一 ID。小写字母开头，仅含 `a-z0-9_-`。示例：`case-demo-001`。同时作为存档命名空间 |
| `title` | string | ✔ | 案件标题，如「逆转的雨夜目击者」 |
| `episode` | string | ✔ | 话数，如「第1话」 |
| `subtitle` | string | — | 副标题，如「～藏在线索链里的真相～」 |
| `author` | string | — | 作者署名（选案菜单展示） |
| `difficulty` | int 1-5 | — | 难度星级 |
| `play_time` | string | — | 预计时长，如「约 15-20 分钟」 |
| `summary` | string | — | 案件简介（不剧透），1-2 句 |
| `prologue` | Script | — | 开场演出（首次进入案件时播放） |
| `epilogue` | Script | — | 尾声演出（结案演出之后播放） |

---

## 3. `characters` — 人物

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✔ | 人物 ID，推荐 `char_` 前缀 |
| `name` | string | ✔ | 显示名 |
| `role` | string | ✔ | 身份，如「被告」「目击证人」「检察官」。结案嫌疑人卡片会展示 |
| `desc` | string | — | 人物简介（结案指认时展示，帮助玩家判断） |
| `color` | string | — | 名牌主题色（可选，如 `#b45309`） |

> 建议至少包含：主角（律师/侦探视角）、助手（吐槽+提示功能）、被告、被害人、目击者、2-3 名嫌疑人、官方角色（刑警/检察官/裁判长）。

---

## 4. `documents` — 案宗文档

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✔ | 文档 ID，推荐 `doc_` 前缀 |
| `type` | enum | ✔ | `record` 笔录/登记 · `testimony` 证词 · `report` 报告 · `photo` 照片/证物 · `letter` 信件 · `news` 报道 · `other` |
| `title` | string | ✔ | 文档标题（卷宗目录显示） |
| `meta` | object | — | 抬头信息：`no`（档案编号，如 K-04）、`author`（出具人）、`date`（日期）、`stamp`（印章文字，如「机密」「已受理」） |
| `initial` | bool | — | 默认 `true`。`false` 表示需解锁 |
| `requires_findings` | string[] | — | 解锁所需结论 ID（全部满足） |
| `requires_clues` | string[] | — | 解锁所需线索 ID（全部满足） |
| `blocks` | Block[] | ✔ | 正文块，至少 1 个 |

### 4.1 Block（正文块）

| type | 字段 | 说明 |
|---|---|---|
| `heading` | `text` | 小节标题（左侧红竖线样式） |
| `para` | `text`，可选 `clue` / `hidden` / `keywords` | 正文段落（首行缩进）；`clue` 使其成为可摘录线索段；`hidden: true` 使其伪装成普通段落；`keywords` 进入圈选模式（见下） |
| `quote` | `text`，可选 `clue` / `hidden` / `keywords` | 引语/证词块（带「引号装饰、浅色底）；可选字段同上 |
| `list` | `items: string[]` | 项目列表 |
| `table` | `rows: string[][]` | 表格，**第一行为表头** |
| `photo` | `caption`，可选 `clue` | 照片/物证占位块（虚框 + PHOTO 徽标 + 图说） |
| `sign` | `text` | 右对齐落款（自动带上分隔线） |
| `dig` | `text` + `reveal: Block[]`（均必需） | 深挖块：显示「深入调查」按钮，点击展开 `reveal` 隐藏段落数组（可含带 clue 的 para/quote，支持嵌套 dig）；`text` 为引导语（如「卷宗背面还有字迹……」） |

> **写作要点**：`clue` 只挂在 para/quote/photo 上；一个文档 1-3 个可摘录段落为宜；线索文本必须真实出现在该段文字里（玩家会核对）。
> **深挖与隐藏线索**（难度递增手段）：
> - `hidden` 必须与 `clue` 同用（校验器强制），仅支持 para/quote；玩家看到的就是一段普通文字，点下去才发现是线索。
> - `dig` 必须有非空 `reveal`（校验器强制）；reveal 内的段落同样可带 `clue` 与 `keywords`。
> - 建议用量：中等难度全案 dig 1-3 处、hidden 0-1 处；高难度（3 星以上）dig 2-4 处、hidden 1-2 处。别滥用，多则玩家麻木。

> **关键词圈选（keywords，强烈推荐作为证词/报告类线索的默认方式）**：
> - `keywords: ["闷响", "连个叫都没有"]` —— 数组每一项**必须是本块 text 的连续子串**（校验器强制）；玩家**须逐一处亲手圈选，圈齐全部字眼后线索才收录上线索板**（不是任一命中即收录）。
> - 配置后本段自动脱离金线标记（`hidden` 声明被取代），玩家必须真读正文才能找到线索；未点中时得到探查提示（显示已圈/还差几处，不剧透答案）。
> - 数组设计：每项都是这条线索的**必要关键处**（如「闷响」与「连个叫都没有」共同构成伪证矛盾），而非同义备选。单项数组则点一处即收录。
> - 同一字眼若在正文中出现多次，渲染时**每一处都可点击**，玩家圈中任意一处即视为该关键处完成——作者若担心"撞词降难度"，可让目标字眼在措辞上唯一出现（引擎不强制唯一）。
> - 字眼选"最定罪的那一个词"：颜色（藏青色）、时间（9点整）、数量（两分钟）、反常行为（监控上周就坏了）——长度 2-10 字为宜；别把整句设为关键词（等于没藏），也别只有 1 个字（点击太难命中）。

---

## 5. `clues` — 线索卡

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✔ | 推荐 `clue_` 前缀 |
| `label` | string | ✔ | 卡片标题，≤ 14 字（如「死亡推定 22:30」） |
| `text` | string | ✔ | 卡片详情，1-3 句。可含数字、引语 |
| `category` | enum | — | `physical` 物证（金色条）· `testimony` 证词（红色条）· `background` 背景（蓝色条）。默认 physical |
| `initial` | bool | — | 默认 `false`；`true` = 开局即在线索板（用于案件基本事实） |
| `source` | string | — | 来源文档 ID，卡片底部显示「出自 K-04」（meta.no 优先展示编号） |

---

## 6. `findings` — 推理结论

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✔ | 推荐 `finding_` 前缀 |
| `label` | string | ✔ | 结论卡标题，≤ 14 字 |
| `text` | string | ✔ | 结论详情（一段完整推理结论，2-4 句） |

**约束**：每个 finding 必须被某议题的 `on_correct.finding` 引用（否则永远无法获得，校验器会警告）。
**用法**：finding 可出现在后续议题的 `answer` / `requires_findings` 中，构成"结论→新推理"的链条。

---

## 7. `questions` — 推理议题

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✔ | 推荐 `q_` 前缀 |
| `title` | string | ✔ | 议题标题（面板列表显示，≤ 10 字最佳） |
| `prompt` | string | ✔ | 问题正文（展示在推理栏，明确要求"用几条线索回答什么"） |
| `stage` | int 1-9 | — | 阶段分组序号（面板排序参考），默认 1 |
| `optional` | bool | — | 支线标记（引擎当前仅作展示排序，不强制） |
| `requires_clues` | string[] | — | 出现条件：需已拥有的线索 |
| `requires_findings` | string[] | — | 出现条件：需已获得的结论 |
| `answer` | string[] | ✔ | 正确答案卡集合（1-4 张；线索/结论混合合法；**顺序无关**） |
| `hint` | string | — | 提示文本（只给方向，不给答案；"提示"按钮消耗一次计数） |
| `locked_hint` | string | — | **未解锁时显示的引导语**：告诉玩家去哪份文档找材料（点名文档标题，不剧透答案）。强烈建议每个带 requires 的议题都写 |
| `on_correct` | object | ✔ | `{ "finding": "<结论id>", "script": Script }` |
| `on_wrong` | object | — | `{ "message": "答错引导语" }` |

**出题原则**：
- prompt 要像"律师对助手说的话"，明确"哪两条/三条线索能证明 X"；
- 教学题（第 1 题）答案 2 张，可直接从两份文档中的显眼事实配对；
- 中后期题可 3 张、含 1 张 finding；
- `on_wrong.message` 给思考方向（"想想有没有材料记录了死亡真正发生的时间？"），禁止直接报答案。注意第一次答错只显示通用文案，`on_wrong.message` 要写成经得起反复阅读的方向提示；
- **高难度案件的 prompt 不要预告"答案由几条线索组成"**——让玩家自己判断材料够不够，配会答错的卡组设计才有效。

---

## 8. `accusation` — 结案

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | string | ✔ | 结案引导语 |
| `suspects` | string[] | ✔ | 嫌疑人人物 ID，2-5 名，必须包含 `culprit` |
| `culprit` | string | ✔ | 真凶人物 ID |
| `required_findings` | string[] | ✔ | 必须提交的结论（同时是结案按钮激活条件），1-3 个 |
| `on_correct.script` | Script | ✔ | 结案演出（8-15 句，含逆转高潮） |
| `on_wrong.message` | string | — | 指控失败提示 |
| `on_wrong.script` | Script | — | 指控失败演出（可选） |

---

## 9. Script — 演出指令

数组，按顺序播放。仅支持 5 种指令：

```json
[
  { "op": "narrate", "text": "2026年11月3日，深夜。" },
  { "op": "say", "who": "char_su", "text": "海帆哥，这就是全部的案宗……" },
  { "op": "say", "who": null, "text": "（旁白形式的人物台词也可以）" },
  { "op": "fx", "type": "flash_text", "text": "异议！" },
  { "op": "fx", "type": "shake" },
  { "op": "fx", "type": "flash" },
  { "op": "bgm", "id": "bgm/trial.mp3" }
]
```

| 指令 | 字段 | 演出效果 |
|---|---|---|
| `say` | `who`（人物 id 或 null），`text` | 底部对话框，姓名标签 + 打字机逐字显示 |
| `narrate` | `text` | 旁白框（灰名牌） |
| `fx` | `type`：`flash_text`（需 `text`，如"异议！"）/ `flash`（白闪）/ `shake`（震屏）/ `fadeout` | 特效 |
| `bgm` / `sfx` | `id` | v2 静默保留（暂无音频素材） |

限制：单句 `text` ≤ 60 字（对话框两行内）；单段 script ≤ 20 条；`say` 的 `who` 必须存在于 characters（null 除外）。

---

## 10. ID 与命名规范

- 统一规则：`^[a-z][a-z0-9_-]*$`（小写字母开头）。
- 推荐前缀：`char_` 人物 · `doc_` 文档 · `clue_` 线索 · `finding_` 结论 · `q_` 议题 · `pr_` 人物档案类线索。
- 文档 `meta.no` 建议用「字母-数字」（如 `K-04`），会显示在目录与顶栏。
- 案件文件命名：`case-<slug>.json`，且与 `case.id` 一致。

---

## 11. 引擎的边界（不要设计超出实现的功能）

- 无自由输入、无对话选项树：所有交互 = 摘录点击 + 线索组合 + 结案选择。
- 无时间限制、无战斗、无多结局：推理失败只扣分不终止。
- 演出仅上面 5 种指令；无立绘/背景图（可用 `photo` 块充当物证图）。
- 线索板一次最多选 4 张卡。
- 议题答案匹配是"集合相等"，不支持"包含即正确"。

---

## 12. 最小可运行骨架

```json
{
  "format_version": "2.0",
  "case": { "id": "case-min", "title": "最小案件", "episode": "第1话" },
  "characters": [
    { "id": "char_a", "name": "律师", "role": "辩方律师" },
    { "id": "char_b", "name": "嫌疑人", "role": "被告" },
    { "id": "char_c", "name": "真凶", "role": "证人" }
  ],
  "documents": [
    { "id": "doc_1", "type": "report", "title": "现场报告",
      "blocks": [ { "type": "para", "text": "案发时间为深夜。", "clue": "clue_t1" } ] },
    { "id": "doc_2", "type": "testimony", "title": "证词",
      "blocks": [ { "type": "quote", "text": "「案发时我在家。」", "clue": "clue_t2" } ] }
  ],
  "clues": [
    { "id": "clue_t1", "label": "案发深夜", "text": "案发时间为深夜。", "source": "doc_1" },
    { "id": "clue_t2", "label": "证词：在家", "text": "证人声称案发时在家。", "category": "testimony", "source": "doc_2" }
  ],
  "findings": [ { "id": "finding_1", "label": "证词可疑", "text": "证词与案发时间存在出入。" } ],
  "questions": [
    { "id": "q_1", "title": "证词疑点", "prompt": "哪两条线索能说明证词站不住脚？",
      "answer": ["clue_t1", "clue_t2"],
      "on_correct": { "finding": "finding_1" },
      "on_wrong": { "message": "再想想时间上的矛盾。" } }
  ],
  "accusation": {
    "prompt": "真凶是谁？", "suspects": ["char_b", "char_c"], "culprit": "char_c",
    "required_findings": ["finding_1"],
    "on_correct": { "script": [ { "op": "fx", "type": "flash_text", "text": "异议！" },
                                { "op": "say", "who": "char_a", "text": "真相只有一个！" } ] }
  }
}
```

> AI生成

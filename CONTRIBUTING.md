# 投稿剧本（案件上架流程）

欢迎投稿原创案件！流程与代码 PR 完全一致，只是你提交的是一份 JSON。

## 前置要求

- **原创性**：可借鉴经典推理母题（时刻表诡计、密室、叙述性诡计等），但人物、场景、情节细节必须全部原创；不接受对现有作品的情节复刻
- **格式合法**：通过校验脚本 0 错误 0 警告
- **公平性**：每道议题的答案必须能仅从文档内容推出（详见 [docs/case-design-guide.md](docs/case-design-guide.md) 公平性红线）
- **内容健康**：避免现实人物、过度血腥描写与违反平台规范的内容

## 投稿步骤

1. Fork 本仓库
2. 把你的剧本 JSON 放入 `cases/` 目录，命名 `case-<slug>.json`（英文小写短横线，与 `case.id` 一致）
3. 在 `cases/index.json` 的 `files` 数组中追加你的文件名，例如：

   ```json
   { "files": ["case-snow-sonata.json", "case-fog-gallery.json", "case-your-case.json"] }
   ```

4. 本地验证（两种任选其一）：

   ```bash
   python scripts/validate_case.py cases/case-your-case.json
   # 或：启动游戏 python -m http.server 8085，首页「新建剧本」粘贴 JSON 验证
   ```

5. 提交 PR，标题格式：`[案件投稿] 逆转的<案件名>（难度 ★N）`

## 审核关注点

- [ ] 校验 0 错误 0 警告（CI 会自动跑校验脚本）
- [ ] 玩家在不知道答案的情况下，凭卷宗推理可通关（自导自演测一遍）
- [ ] 难度标注与实际体验相符（参考 docs/case-design-guide.md 难度分级表）
- [ ] 演出无错别字、时长在声明的 play_time 范围内

## 小贴士

- 卡壳时，把 `docs/case-design-guide.md` 的「常见失败案例自查清单」过一遍
- 想要跌宕起伏的体验，优先设计**误导与翻转**（红鲱鱼、拼后拆、三重翻转），而不是堆文档数量
- 建议先用游戏内「新建剧本」粘贴试玩，调好节奏再提 PR

> AI生成

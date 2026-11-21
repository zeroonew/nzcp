# NZCP · 案宗推理（NZCP Dossier Detective）

> 阅读案宗 · 圈出字眼 · 串联线索 · 逆转真相

一款**零依赖、纯前端**的逆转裁判式案宗推理游戏。玩家在卷宗正文中亲手圈出关键字眼，把线索组合上线索板，一层层推翻表面案情，最终在结案陈词中指认真凶。

本仓库同时是 **NZCP Script Format 2.0** 的官方规范与剧本集散地：任何人都可以按规范创作剧本并投稿上架。

- 主题：本格推理 · 文字冒险
- 技术：纯静态前端（HTML/CSS/JS，无框架、无后端、无构建）
- 存档：浏览器 localStorage（自动保存，随浏览器走）
- 内置案件：第 1 话《逆转的雪夜琴声》、第 2 话《逆转的雾夜画廊》

## 快速开始

```bash
git clone https://github.com/<你的用户名>/nzcp.git
cd nzcp
python -m http.server 8085
# 浏览器打开 http://localhost:8085/
```

> 也可以用任意静态文件服务器（nginx、`npx serve` 等）托管本目录；部署到 GitHub Pages / Vercel / 对象存储同理，无需任何配置。

## 玩法速览

1. **阅读卷宗**：正文中藏着关键字眼——发现不对劲的词，**点它，用红笔圈出来**；一条线索的全部关键处圈齐，才收录上线索板
2. **组合推理**：在推理议题里选 1-4 张卡组合出结论，答对解锁新卷宗
3. **层层翻转**：证据链逐步推翻表面案情（检方概要也不可全信）
4. **结案陈词**：指认真凶 + 提交支撑结论，S 级通关

## 创作你自己的剧本（三步）

NZCP 剧本就是一个 JSON 文件，**不需要会编程**：

1. **喂规范给 AI**：把 [`docs/format-spec.md`](docs/format-spec.md)（格式规范）与 [`docs/case-design-guide.md`](docs/case-design-guide.md)（设计方法论）整份发给任意 AI 助手，提出你的案件构想
2. **校验**：把 AI 生成的 JSON 用 [`scripts/validate_case.py`](scripts/validate_case.py) 本地预检（可选），或直接进入下一步——游戏端会二次校验
3. **游玩**：
   - **在线站**：首页「新建剧本」→ 粘贴 JSON → 校验并导入，立即可玩
   - **本地**：首页「导入剧本 (.json)」选择文件即可
   - **上架官方库**：按 [CONTRIBUTING.md](CONTRIBUTING.md) 提 PR，合并后所有玩家都能玩到你的案件

## 目录结构

```
├─ index.html            游戏入口（纯静态）
├─ css/  js/             样式与逻辑（engine 校验/状态 · ui 渲染 · main 交互）
├─ cases/                内置剧本目录（index.json 注册上架）
│   ├─ case-snow-sonata.json    第1话 · 逆转的雪夜琴声（★★★★☆）
│   └─ case-fog-gallery.json     第2话 · 逆转的雾夜画廊（★★★★★）
├─ docs/                剧本创作规范（喂给 AI 即可创作）
├─ scripts/              validate_case.py 剧本校验脚本
└─ script-format/        JSON Schema
```

## 兼容与要求

- 现代浏览器（Chrome / Edge / Firefox / Safari），桌面端体验最佳
- 无需联网（首次加载后可离线游玩；剧本由页面同源 fetch 读取）

## License

代码与文档采用 [MIT License](LICENSE)；各剧本文件版权归其作者所有，随仓库以同协议发布。

> AI生成

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NZCP 案宗推理剧本校验器（NZCP Script Format 2.0）

用法:
    python validate_case.py <案件剧本.json>

退出码:
    0 = 校验通过（可能有警告）
    1 = 校验未通过（存在错误）
    2 = 文件读取或 JSON 解析失败

校验内容:
    - 结构与必填字段
    - ID 合法性（小写字母开头，仅含小写字母/数字/_/-）与唯一性
    - 线索 / 结论 / 文档 / 题目之间的引用完整性
    - 可达性警告（无法获得的线索、无法解锁的文档、无产出的结论）
"""

import json
import re
import sys

ID_RE = re.compile(r"^[a-z][a-z0-9_-]*$")
FORMAT_VERSION = "2.0"


def validate(data):
    errors = []
    warnings = []

    def err(msg):
        errors.append(msg)

    def warn(msg):
        warnings.append(msg)

    def walk_blocks(blocks, prefix, fn, *extra):
        """递归遍历 blocks（含 dig.reveal 嵌套），path 形如 'blocks[2]' 或 'blocks[2].reveal[0]'"""
        for bi, b in enumerate(blocks or []):
            path = "%s[%d]" % (prefix, bi)
            fn(b, path, *extra)
            if isinstance(b, dict) and b.get("type") == "dig" and isinstance(b.get("reveal"), list):
                walk_blocks(b["reveal"], path + ".reveal", fn, *extra)

    if not isinstance(data, dict):
        return ["剧本根节点必须是一个 JSON 对象"], []

    if data.get("format_version") != FORMAT_VERSION:
        err('format_version 必须为 "%s"，当前为 %r' % (FORMAT_VERSION, data.get("format_version")))

    case = data.get("case") or {}
    if not isinstance(case, dict):
        err("case 必须是对象")
        case = {}
    for key in ("id", "title", "episode"):
        if not case.get(key):
            err("case.%s 缺失" % key)
    if case.get("id") and not ID_RE.match(str(case["id"])):
        err('case.id "%s" 不合法（须小写字母开头，仅含小写字母/数字/_/-）' % case["id"])

    characters = data.get("characters") if isinstance(data.get("characters"), list) else []
    documents = data.get("documents") if isinstance(data.get("documents"), list) else []
    clues = data.get("clues") if isinstance(data.get("clues"), list) else []
    questions = data.get("questions") if isinstance(data.get("questions"), list) else []
    findings = data.get("findings") if isinstance(data.get("findings"), list) else []

    if not characters:
        err("characters 不能为空")
    if not documents:
        err("documents 不能为空")
    if not clues:
        err("clues 不能为空")
    if not questions:
        err("questions 不能为空")

    char_ids = {}
    doc_ids = {}
    clue_ids = {}
    q_ids = {}
    find_ids = {}

    def _check_block(b, path, doc_id):
        """dig/hidden 结构校验（供 walk_blocks 回调）"""
        if not isinstance(b, dict) or not b.get("type"):
            return
        if b["type"] == "dig" and (not isinstance(b.get("reveal"), list) or not b["reveal"]):
            err("文档 %s %s 是 dig 深挖块，但缺少 reveal 隐藏段落" % (doc_id, path))
        if b.get("hidden"):
            if not b.get("clue"):
                err("文档 %s %s 声明为隐藏线索块，但缺少 clue" % (doc_id, path))
            if b["type"] not in ("para", "quote"):
                err("文档 %s %s 的 hidden 仅支持 para/quote" % (doc_id, path))

    def _check_block_ref(b, path, doc_id):
        """clue/keywords 引用校验（供 walk_blocks 回调，需在 clue_ids 完整后调用）"""
        if not isinstance(b, dict):
            return
        if b.get("clue") and b["clue"] not in clue_ids:
            err("文档 %s %s 引用了不存在的线索 %s" % (doc_id, path, b["clue"]))
        kws = b.get("keywords")
        if isinstance(kws, list) and kws:
            if not b.get("clue"):
                err("文档 %s %s 配置了 keywords，但缺少 clue" % (doc_id, path))
            if b.get("type") not in ("para", "quote"):
                err("文档 %s %s 的 keywords 仅支持 para/quote" % (doc_id, path))
            for ki, kw in enumerate(kws):
                if not isinstance(kw, str) or not kw:
                    err("文档 %s %s keywords[%d] 必须是非空字符串" % (doc_id, path, ki))
                elif not b.get("text") or kw not in str(b["text"]):
                    err("文档 %s %s keywords[%d]「%s」未出现在该块正文中" % (doc_id, path, ki, kw))
            if b.get("clue") in clue_ids and clue_ids[b["clue"]].get("initial") is True:
                warn("文档 %s %s 的线索 %s 为 initial（开局即在线索板），关键词圈选不会生效" % (doc_id, path, b["clue"]))

    def _collect_ref(b, path, referenced):
        """可达性收集（供 walk_blocks 回调）"""
        if isinstance(b, dict) and b.get("clue"):
            referenced[b["clue"]] = True

    # ---- characters ----
    for i, ch in enumerate(characters):
        where = "characters[%d]" % i
        if not isinstance(ch, dict) or not ch.get("id"):
            err("%s 缺少 id" % where)
            continue
        if not ID_RE.match(str(ch["id"])):
            err('%s.id "%s" 不合法' % (where, ch["id"]))
        if ch["id"] in char_ids:
            err("人物 ID 重复：%s" % ch["id"])
        char_ids[ch["id"]] = ch
        if not ch.get("name"):
            err("人物 %s 缺少 name" % ch["id"])
        if not ch.get("role"):
            err("人物 %s 缺少 role" % ch["id"])

    # ---- documents ----
    for i, doc in enumerate(documents):
        where = "documents[%d]" % i
        if not isinstance(doc, dict) or not doc.get("id"):
            err("%s 缺少 id" % where)
            continue
        if not ID_RE.match(str(doc["id"])):
            err('%s.id "%s" 不合法' % (where, doc["id"]))
        if doc["id"] in doc_ids:
            err("文档 ID 重复：%s" % doc["id"])
        doc_ids[doc["id"]] = doc
        if not doc.get("title"):
            err("文档 %s 缺少 title" % doc["id"])
        blocks = doc.get("blocks")
        if not isinstance(blocks, list) or not blocks:
            err("文档 %s 缺少 blocks" % doc["id"])
            blocks = []
        for bi, b in enumerate(blocks):
            if not isinstance(b, dict) or not b.get("type"):
                err("文档 %s blocks[%d] 缺少 type" % (doc["id"], bi))
        walk_blocks(blocks, "blocks", _check_block, doc["id"])

    # ---- clues ----
    for i, clue in enumerate(clues):
        where = "clues[%d]" % i
        if not isinstance(clue, dict) or not clue.get("id"):
            err("%s 缺少 id" % where)
            continue
        if not ID_RE.match(str(clue["id"])):
            err('%s.id "%s" 不合法' % (where, clue["id"]))
        if clue["id"] in clue_ids:
            err("线索 ID 重复：%s" % clue["id"])
        clue_ids[clue["id"]] = clue
        if not clue.get("label"):
            err("线索 %s 缺少 label" % clue["id"])
        if not clue.get("text"):
            err("线索 %s 缺少 text" % clue["id"])
        if clue.get("source") and clue["source"] not in doc_ids:
            err("线索 %s 的 source 文档不存在：%s" % (clue["id"], clue["source"]))

    # ---- documents 引用（clue 已在 clue_ids 完整后检查）----
    for doc in documents:
        if not isinstance(doc, dict) or not doc.get("id"):
            continue
        walk_blocks(doc.get("blocks") or [], "blocks", _check_block_ref, doc["id"])
        for cid in doc.get("requires_clues") or []:
            if cid not in clue_ids:
                err("文档 %s requires_clues 引用不存在的线索：%s" % (doc["id"], cid))

    # ---- findings ----
    for i, f in enumerate(findings):
        where = "findings[%d]" % i
        if not isinstance(f, dict) or not f.get("id"):
            err("%s 缺少 id" % where)
            continue
        if not ID_RE.match(str(f["id"])):
            err('%s.id "%s" 不合法' % (where, f["id"]))
        if f["id"] in find_ids:
            err("结论 ID 重复：%s" % f["id"])
        find_ids[f["id"]] = f
        if not f.get("label"):
            err("结论 %s 缺少 label" % f["id"])
        if not f.get("text"):
            err("结论 %s 缺少 text" % f["id"])

    for doc in documents:
        if not isinstance(doc, dict) or not doc.get("id"):
            continue
        for fid in doc.get("requires_findings") or []:
            if fid not in find_ids:
                err("文档 %s requires_findings 引用不存在的结论：%s" % (doc["id"], fid))

    # ---- questions ----
    for i, q in enumerate(questions):
        where = "questions[%d]" % i
        if not isinstance(q, dict) or not q.get("id"):
            err("%s 缺少 id" % where)
            continue
        if not ID_RE.match(str(q["id"])):
            err('%s.id "%s" 不合法' % (where, q["id"]))
        if q["id"] in q_ids:
            err("题目 ID 重复：%s" % q["id"])
        q_ids[q["id"]] = q
        if not q.get("title"):
            err("题目 %s 缺少 title" % q["id"])
        if not q.get("prompt"):
            err("题目 %s 缺少 prompt" % q["id"])
        answer = q.get("answer")
        if not isinstance(answer, list) or not answer:
            err("题目 %s 缺少 answer 数组" % q["id"])
            answer = []
        if len(answer) > 4:
            err("题目 %s 的 answer 超过 4 项（引擎上限 4）" % q["id"])
        for cid in answer:
            if cid not in clue_ids and cid not in find_ids:
                err("题目 %s 的 answer 引用不存在的线索/结论：%s" % (q["id"], cid))
        for cid in q.get("requires_clues") or []:
            if cid not in clue_ids:
                err("题目 %s requires_clues 引用不存在的线索：%s" % (q["id"], cid))
        for fid in q.get("requires_findings") or []:
            if fid not in find_ids:
                err("题目 %s requires_findings 引用不存在的结论：%s" % (q["id"], fid))
        oc = q.get("on_correct") or {}
        if not oc.get("finding"):
            err("题目 %s 缺少 on_correct.finding" % q["id"])
        elif oc["finding"] not in find_ids:
            err("题目 %s 的 on_correct.finding 结论不存在：%s" % (q["id"], oc["finding"]))

    # ---- accusation ----
    acc = data.get("accusation") or {}
    if not isinstance(acc, dict):
        err("accusation 必须是对象")
        acc = {}
    if not acc.get("prompt"):
        err("accusation.prompt 缺失")
    suspects = acc.get("suspects") or []
    if not isinstance(suspects, list) or len(suspects) < 2:
        err("accusation.suspects 至少需要 2 名嫌疑人")
        suspects = suspects if isinstance(suspects, list) else []
    for cid in suspects:
        if cid not in char_ids:
            err("accusation.suspects 引用不存在的人物：%s" % cid)
    culprit = acc.get("culprit")
    if not culprit:
        err("accusation.culprit 缺失")
    elif culprit not in suspects:
        err("accusation.culprit 必须是 suspects 之一：%s" % culprit)
    req = acc.get("required_findings") or []
    if not isinstance(req, list) or not req:
        err("accusation.required_findings 不能为空")
        req = req if isinstance(req, list) else []
    for fid in req:
        if fid not in find_ids:
            err("accusation.required_findings 引用不存在的结论：%s" % fid)
    oc = acc.get("on_correct") or {}
    if not isinstance(oc.get("script"), list):
        err("accusation.on_correct.script 缺失")

    # ---- 可达性警告 ----
    referenced = {}
    for doc in documents:
        if not isinstance(doc, dict):
            continue
        walk_blocks(doc.get("blocks") or [], "blocks", _collect_ref, referenced)
    for clue in clues:
        if not isinstance(clue, dict) or not clue.get("id"):
            continue
        if clue.get("initial") is not True and clue["id"] not in referenced:
            warn("线索 %s 既非 initial，也没有被任何文档段落引用 —— 玩家将永远无法获得它" % clue["id"])

    produced = {}
    for q in questions:
        if isinstance(q, dict):
            oc = q.get("on_correct") or {}
            if oc.get("finding"):
                produced[oc["finding"]] = True
    for f in findings:
        if isinstance(f, dict) and f.get("id") and f["id"] not in produced:
            warn("结论 %s 没有对应的题目产出 —— 玩家将永远无法获得它" % f["id"])

    for doc in documents:
        if not isinstance(doc, dict) or not doc.get("id"):
            continue
        if doc.get("initial") is False:
            if not (doc.get("requires_findings") or doc.get("requires_clues")):
                warn("文档 %s 非初始可见，但没有配置 requires_* 条件 —— 玩家将永远无法解锁它" % doc["id"])

    return errors, warnings


def main():
    if len(sys.argv) < 2:
        print("用法: python validate_case.py <案件剧本.json>")
        return 2
    path = sys.argv[1]
    try:
        # utf-8-sig：兼容 Windows 工具（记事本 / PowerShell）写出的带 BOM 文件
        with open(path, "r", encoding="utf-8-sig") as fh:
            data = json.load(fh)
    except OSError as exc:
        print("[读取失败] %s" % exc)
        return 2
    except json.JSONDecodeError as exc:
        print("[JSON 解析失败] 第 %d 行第 %d 列：%s" % (exc.lineno, exc.colno, exc.msg))
        return 2

    errors, warnings = validate(data)

    case = data.get("case") if isinstance(data, dict) else None
    title = (case or {}).get("title", "（未命名）")
    case_id = (case or {}).get("id", "?")

    print("=" * 46)
    print("NZCP 剧本校验报告")
    print("=" * 46)
    print("文件: %s" % path)
    print("案件: %s (%s)" % (title, case_id))
    print("")

    if errors:
        print("[错误] 共 %d 个：" % len(errors))
        for i, msg in enumerate(errors, 1):
            print("  %d. %s" % (i, msg))
        print("")

    if warnings:
        print("[警告] 共 %d 个（不阻断加载，但建议处理）：" % len(warnings))
        for i, msg in enumerate(warnings, 1):
            print("  %d. %s" % (i, msg))
        print("")

    if errors:
        print("结果: 校验未通过 —— 请修复上述错误后重试。")
        return 1

    print("结果: 校验通过（0 错误，%d 警告）。剧本可导入 NZCP 游玩。" % len(warnings))
    return 0


if __name__ == "__main__":
    sys.exit(main())
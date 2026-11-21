/* =========================================================
   NZCP Engine — 案宗推理剧本引擎（纯逻辑层）
   职责：剧本校验 / 案件状态管理 / 推理判定 / 结案判定 / 存档
   依赖：无（浏览器与 Node 均可运行核心逻辑）
   ========================================================= */
(function (global) {
  'use strict';

  var FORMAT_VERSION = '2.0';
  var SAVE_PREFIX = 'nzcp_save_v2_';
  var IMPORT_KEY = 'nzcp_imported_cases_v2';

  var ID_RE = /^[a-z][a-z0-9_-]*$/;

  /* ---------------------------------------------------------
     剧本校验：语法结构 + 引用完整性 + 可达性警告
     返回 { errors: string[], warnings: string[] }
     --------------------------------------------------------- */
  function validateCase(data) {
    var errors = [];
    var warnings = [];
    function err(msg) { errors.push(msg); }
    function warn(msg) { warnings.push(msg); }

    // 递归遍历 blocks（含 dig.reveal 嵌套），path 形如 'blocks[2]' 或 'blocks[2].reveal[0]'
    function walkBlocks(blocks, prefix, fn) {
      (blocks || []).forEach(function (b, bi) {
        var path = prefix + '[' + bi + ']';
        fn(b, path);
        if (b && b.type === 'dig' && Array.isArray(b.reveal)) walkBlocks(b.reveal, path + '.reveal', fn);
      });
    }

    if (!data || typeof data !== 'object') {
      return { errors: ['剧本不是一个有效的 JSON 对象'], warnings: warnings };
    }
    if (data.format_version !== FORMAT_VERSION) {
      err('format_version 必须为 "' + FORMAT_VERSION + '"，当前为 ' + JSON.stringify(data.format_version));
    }

    var c = data.case || {};
    ['id', 'title', 'episode'].forEach(function (k) {
      if (!c[k]) err('case.' + k + ' 缺失');
    });
    if (c.id && !ID_RE.test(c.id)) err('case.id "' + c.id + '" 不合法（须小写字母开头，仅含小写字母/数字/_/-）');

    var characters = Array.isArray(data.characters) ? data.characters : [];
    var documents = Array.isArray(data.documents) ? data.documents : [];
    var clues = Array.isArray(data.clues) ? data.clues : [];
    var questions = Array.isArray(data.questions) ? data.questions : [];
    var findings = Array.isArray(data.findings) ? data.findings : [];

    if (!characters.length) err('characters 不能为空');
    if (!documents.length) err('documents 不能为空');
    if (!clues.length) err('clues 不能为空');
    if (!questions.length) err('questions 不能为空');

    var charIds = Object.create(null);
    var docIds = Object.create(null);
    var clueIds = Object.create(null);
    var qIds = Object.create(null);
    var findIds = Object.create(null);

    characters.forEach(function (ch, i) {
      if (!ch || !ch.id) return err('characters[' + i + '] 缺少 id');
      if (!ID_RE.test(ch.id)) err('characters[' + i + '].id "' + ch.id + '" 不合法');
      if (charIds[ch.id]) err('人物 ID 重复：' + ch.id);
      charIds[ch.id] = ch;
      if (!ch.name) err('人物 ' + ch.id + ' 缺少 name');
      if (!ch.role) err('人物 ' + ch.id + ' 缺少 role');
    });

    documents.forEach(function (doc, i) {
      var where = 'documents[' + i + ']';
      if (!doc || !doc.id) return err(where + ' 缺少 id');
      if (!ID_RE.test(doc.id)) err(where + '.id "' + doc.id + '" 不合法');
      if (docIds[doc.id]) err('文档 ID 重复：' + doc.id);
      docIds[doc.id] = doc;
      if (!doc.title) err('文档 ' + doc.id + ' 缺少 title');
      if (!Array.isArray(doc.blocks) || !doc.blocks.length) err('文档 ' + doc.id + ' 缺少 blocks');
      walkBlocks(doc.blocks, 'blocks', function (b, path) {
        if (!b || !b.type) { err('文档 ' + doc.id + ' ' + path + ' 缺少 type'); return; }
        if (b.type === 'dig' && (!Array.isArray(b.reveal) || !b.reveal.length)) {
          err('文档 ' + doc.id + ' ' + path + ' 是 dig 深挖块，但缺少 reveal 隐藏段落');
        }
        if (b.hidden) {
          if (!b.clue) err('文档 ' + doc.id + ' ' + path + ' 声明为隐藏线索块，但缺少 clue');
          if (b.type !== 'para' && b.type !== 'quote') err('文档 ' + doc.id + ' ' + path + ' 的 hidden 仅支持 para/quote');
        }
      });
    });

    clues.forEach(function (clue, i) {
      var where = 'clues[' + i + ']';
      if (!clue || !clue.id) return err(where + ' 缺少 id');
      if (!ID_RE.test(clue.id)) err(where + '.id "' + clue.id + '" 不合法');
      if (clueIds[clue.id]) err('线索 ID 重复：' + clue.id);
      clueIds[clue.id] = clue;
      if (!clue.label) err('线索 ' + clue.id + ' 缺少 label');
      if (!clue.text) err('线索 ' + clue.id + ' 缺少 text');
      if (clue.source && !docIds[clue.source]) err('线索 ' + clue.id + ' 的 source 文档不存在：' + clue.source);
    });

    // 文档 blocks（含 dig.reveal 隐藏段落）的 clue 引用二次确认（此时 clueIds 已完整）
    documents.forEach(function (doc) {
      walkBlocks(doc.blocks, 'blocks', function (b, path) {
        if (b && b.clue && !clueIds[b.clue]) {
          err('文档 ' + doc.id + ' ' + path + ' 引用了不存在的线索 ' + b.clue);
        }
        // 关键词圈选（keywords）校验
        if (b && Array.isArray(b.keywords) && b.keywords.length) {
          if (!b.clue) err('文档 ' + doc.id + ' ' + path + ' 配置了 keywords，但缺少 clue');
          if (b.type !== 'para' && b.type !== 'quote') err('文档 ' + doc.id + ' ' + path + ' 的 keywords 仅支持 para/quote');
          b.keywords.forEach(function (kw, ki) {
            if (typeof kw !== 'string' || !kw) {
              err('文档 ' + doc.id + ' ' + path + ' keywords[' + ki + '] 必须是非空字符串');
            } else if (!b.text || String(b.text).indexOf(kw) === -1) {
              err('文档 ' + doc.id + ' ' + path + ' keywords[' + ki + ']「' + kw + '」未出现在该块正文中');
            }
          });
          if (b.clue && clueIds[b.clue] && clueIds[b.clue].initial === true) {
            warn('文档 ' + doc.id + ' ' + path + ' 的线索 ' + b.clue + ' 为 initial（开局即在线索板），关键词圈选不会生效');
          }
        }
      });
      (doc.requires_clues || []).forEach(function (id) {
        if (!clueIds[id]) err('文档 ' + doc.id + ' requires_clues 引用不存在的线索：' + id);
      });
    });

    findings.forEach(function (f, i) {
      var where = 'findings[' + i + ']';
      if (!f || !f.id) return err(where + ' 缺少 id');
      if (!ID_RE.test(f.id)) err(where + '.id "' + f.id + '" 不合法');
      if (findIds[f.id]) err('结论 ID 重复：' + f.id);
      findIds[f.id] = f;
      if (!f.label) err('结论 ' + f.id + ' 缺少 label');
      if (!f.text) err('结论 ' + f.id + ' 缺少 text');
    });

    // 文档 requires_findings
    documents.forEach(function (doc) {
      (doc.requires_findings || []).forEach(function (id) {
        if (!findIds[id]) err('文档 ' + doc.id + ' requires_findings 引用不存在的结论：' + id);
      });
    });

    questions.forEach(function (q, i) {
      var where = 'questions[' + i + ']';
      if (!q || !q.id) return err(where + ' 缺少 id');
      if (!ID_RE.test(q.id)) err(where + '.id "' + q.id + '" 不合法');
      if (qIds[q.id]) err('题目 ID 重复：' + q.id);
      qIds[q.id] = q;
      if (!q.title) err('题目 ' + q.id + ' 缺少 title');
      if (!q.prompt) err('题目 ' + q.id + ' 缺少 prompt');
      if (!Array.isArray(q.answer) || !q.answer.length) err('题目 ' + q.id + ' 缺少 answer 数组');
      (q.answer || []).forEach(function (id) {
        if (!clueIds[id] && !findIds[id]) err('题目 ' + q.id + ' 的 answer 引用不存在的线索/结论：' + id);
      });
      (q.requires_clues || []).forEach(function (id) {
        if (!clueIds[id]) err('题目 ' + q.id + ' requires_clues 引用不存在的线索：' + id);
      });
      (q.requires_findings || []).forEach(function (id) {
        if (!findIds[id]) err('题目 ' + q.id + ' requires_findings 引用不存在的结论：' + id);
      });
      if (!q.on_correct || !q.on_correct.finding) {
        err('题目 ' + q.id + ' 缺少 on_correct.finding');
      } else if (!findIds[q.on_correct.finding]) {
        err('题目 ' + q.id + ' 的 on_correct.finding 结论不存在：' + q.on_correct.finding);
      }
    });

    var acc = data.accusation || {};
    if (!acc.prompt) err('accusation.prompt 缺失');
    if (!Array.isArray(acc.suspects) || acc.suspects.length < 2) err('accusation.suspects 至少需要 2 名嫌疑人');
    (acc.suspects || []).forEach(function (id) {
      if (!charIds[id]) err('accusation.suspects 引用不存在的人物：' + id);
    });
    if (!acc.culprit) err('accusation.culprit 缺失');
    else if ((acc.suspects || []).indexOf(acc.culprit) === -1) err('accusation.culprit 必须是 suspects 之一：' + acc.culprit);
    if (!Array.isArray(acc.required_findings) || !acc.required_findings.length) err('accusation.required_findings 不能为空');
    (acc.required_findings || []).forEach(function (id) {
      if (!findIds[id]) err('accusation.required_findings 引用不存在的结论：' + id);
    });
    if (!acc.on_correct || !Array.isArray(acc.on_correct.script)) err('accusation.on_correct.script 缺失');

    /* ---------- 可达性警告（不阻断加载） ---------- */
    var referencedClues = Object.create(null);
    documents.forEach(function (doc) {
      walkBlocks(doc.blocks, 'blocks', function (b) {
        if (b && b.clue) referencedClues[b.clue] = true;
      });
    });
    clues.forEach(function (clue) {
      if (clue.initial !== true && !referencedClues[clue.id]) {
        warn('线索 ' + clue.id + ' 既非 initial，也没有被任何文档段落引用 —— 玩家将永远无法获得它');
      }
    });

    var producedFindings = Object.create(null);
    questions.forEach(function (q) {
      if (q.on_correct && q.on_correct.finding) producedFindings[q.on_correct.finding] = true;
    });
    findings.forEach(function (f) {
      if (!producedFindings[f.id]) warn('结论 ' + f.id + ' 没有对应的题目产出 —— 玩家将永远无法获得它');
    });

    documents.forEach(function (doc) {
      if (doc.initial === false) {
        var hasReq = (doc.requires_findings || []).length || (doc.requires_clues || []).length;
        if (!hasReq) warn('文档 ' + doc.id + ' 非初始可见，但没有配置 requires_* 条件 —— 玩家将永远无法解锁它');
      }
    });

    return { errors: errors, warnings: warnings };
  }

  /* ---------------------------------------------------------
     案件引擎
     --------------------------------------------------------- */
  function CaseEngine(data, saveState) {
    this.data = data;
    this.state = saveState || {
      extracted: [],     // 已摘录线索 id
      solved: [],        // 已解决题目 id
      mistakes: 0,       // 失误次数（答错议题/结案）
      hintsUsed: 0,      // 提示次数
      readDocs: [],      // 已阅读文档 id
      finished: false,   // 是否结案
      startedAt: Date.now()
    };
    // 兼容旧存档字段
    if (!Array.isArray(this.state.extracted)) this.state.extracted = [];
    if (!Array.isArray(this.state.solved)) this.state.solved = [];
    if (!Array.isArray(this.state.readDocs)) this.state.readDocs = [];
    if (typeof this.state.mistakes !== 'number') this.state.mistakes = 0;
    if (typeof this.state.hintsUsed !== 'number') this.state.hintsUsed = 0;
    if (!this.state.digOpened || typeof this.state.digOpened !== 'object') this.state.digOpened = {};
    if (!this.state.wrongAttempts || typeof this.state.wrongAttempts !== 'object') this.state.wrongAttempts = {};
    // 关键词圈选进度：{ clueId: [已圈选的字眼...] }（线索收录前逐词记录）
    if (!this.state.circled || typeof this.state.circled !== 'object') this.state.circled = {};
  }

  /* ---------- 深挖（dig）状态 ---------- */
  CaseEngine.prototype.digKey = function (docId, blockIdx) {
    return docId + ':' + blockIdx;
  };

  CaseEngine.prototype.isDigOpened = function (docId, blockIdx) {
    return this.state.digOpened[this.digKey(docId, blockIdx)] === true;
  };

  CaseEngine.prototype.openDig = function (docId, blockIdx) {
    this.state.digOpened[this.digKey(docId, blockIdx)] = true;
    this.save();
  };

  /* ---------- 议题答错分级（防穷举） ---------- */
  CaseEngine.prototype.getWrongAttempts = function (qid) {
    return this.state.wrongAttempts[qid] || 0;
  };

  CaseEngine.prototype.getClue = function (id) {
    return this.data.clues.filter(function (c) { return c.id === id; })[0] || null;
  };

  CaseEngine.prototype.getDoc = function (id) {
    return this.data.documents.filter(function (d) { return d.id === id; })[0] || null;
  };

  CaseEngine.prototype.getQuestion = function (id) {
    return this.data.questions.filter(function (q) { return q.id === id; })[0] || null;
  };

  CaseEngine.prototype.getFinding = function (id) {
    return this.data.findings.filter(function (f) { return f.id === id; })[0] || null;
  };

  /* 线索是否可用（initial 或已摘录） */
  CaseEngine.prototype.hasClue = function (id) {
    var clue = this.getClue(id);
    if (!clue) return false;
    return clue.initial === true || this.state.extracted.indexOf(id) !== -1;
  };

  /* 已获得的结论（由已解决题目派生） */
  CaseEngine.prototype.getFindings = function () {
    var set = {};
    var self = this;
    this.state.solved.forEach(function (qid) {
      var q = self.getQuestion(qid);
      if (q && q.on_correct && q.on_correct.finding) set[q.on_correct.finding] = true;
    });
    return this.data.findings.filter(function (f) { return set[f.id]; });
  };

  CaseEngine.prototype.hasFinding = function (id) {
    return this.getFindings().some(function (f) { return f.id === id; });
  };

  /* 文档是否解锁 */
  CaseEngine.prototype.isDocAvailable = function (doc) {
    if (doc.initial !== false) return true;
    var self = this;
    var rf = doc.requires_findings || [];
    var rc = doc.requires_clues || [];
    return rf.every(function (id) { return self.hasFinding(id); }) &&
           rc.every(function (id) { return self.hasClue(id); });
  };

  /* 题目是否可回答（前置满足且未解决） */
  CaseEngine.prototype.isQuestionAvailable = function (q) {
    if (this.state.solved.indexOf(q.id) !== -1) return false;
    var self = this;
    var rc = q.requires_clues || [];
    var rf = q.requires_findings || [];
    return rc.every(function (id) { return self.hasClue(id); }) &&
           rf.every(function (id) { return self.hasFinding(id); });
  };

  /* 计算议题缺失的材料（用于 UI 引导） */
  CaseEngine.prototype.getQuestionMissing = function (q) {
    var self = this;
    var missClues = [];
    var missFindings = [];
    (q.requires_clues || []).forEach(function (id) {
      if (!self.hasClue(id)) missClues.push(id);
    });
    (q.requires_findings || []).forEach(function (id) {
      if (!self.hasFinding(id)) missFindings.push(id);
    });
    return { clues: missClues, findings: missFindings, total: missClues.length + missFindings.length };
  };

  /* 文档是否含未摘录的新线索段（用于目录"新线索"角标）
     隐藏线索段（hidden）不参与统计——角标不得泄露隐藏线索的存在；
     未展开的深挖（dig）内容也不参与统计 */
  CaseEngine.prototype.docHasNewClues = function (doc) {
    if (!doc || !this.isDocAvailable(doc)) return false;
    var self = this;
    var has = false;
    (doc.blocks || []).forEach(function (b, bi) {
      if (has) return;
      if (!b) return;
      if (b.type === 'dig') {
        if (self.isDigOpened(doc.id, bi)) {
          (b.reveal || []).forEach(function (rb) {
            if (has || !rb || !rb.clue) return;
            var clue = self.getClue(rb.clue);
            if (clue && clue.initial !== true && self.state.extracted.indexOf(rb.clue) === -1) has = true;
          });
        }
        return;
      }
      if (!b.clue || b.hidden) return;
      var clue = self.getClue(b.clue);
      if (clue && clue.initial !== true && self.state.extracted.indexOf(b.clue) === -1) has = true;
    });
    return has;
  };

  CaseEngine.prototype.isQuestionLocked = function (q) {
    if (this.state.solved.indexOf(q.id) !== -1) return false;
    return !this.isQuestionAvailable(q);
  };

  /* 线索板卡片：可用线索 + 已获结论 */
  CaseEngine.prototype.getBoardCards = function () {
    var cards = [];
    var self = this;
    this.data.clues.forEach(function (clue) {
      if (self.hasClue(clue.id)) {
        cards.push({
          id: clue.id,
          kind: 'clue',
          label: clue.label,
          text: clue.text,
          category: clue.category || 'physical',
          source: clue.source || ''
        });
      }
    });
    this.getFindings().forEach(function (f) {
      cards.push({
        id: f.id,
        kind: 'finding',
        label: f.label,
        text: f.text,
        category: 'deduction',
        source: ''
      });
    });
    return cards;
  };

  /* 摘录线索 */
  CaseEngine.prototype.extractClue = function (id) {
    if (this.state.extracted.indexOf(id) !== -1) return false;
    var clue = this.getClue(id);
    if (!clue) return false;
    this.state.extracted.push(id);
    this.save();
    return true;
  };

  /* 某线索的全部可圈选字眼（扫描所有文档块含 dig.reveal；跨块取并集去重） */
  CaseEngine.prototype.getClueKeywords = function (clueId) {
    var seen = Object.create(null);
    var kws = [];
    function scan(blocks) {
      (blocks || []).forEach(function (b) {
        if (b && b.clue === clueId && Array.isArray(b.keywords)) {
          b.keywords.forEach(function (k) {
            if (typeof k === 'string' && k && !seen[k]) { seen[k] = true; kws.push(k); }
          });
        }
        if (b && b.type === 'dig' && Array.isArray(b.reveal)) scan(b.reveal);
      });
    }
    this.data.documents.forEach(function (doc) { scan(doc.blocks); });
    return kws;
  };

  /* 圈选一个字眼：逐词记录，圈齐全部字眼才算完成（complete=true 时调用方再摘录） */
  CaseEngine.prototype.circleKeyword = function (clueId, kw) {
    var total = this.getClueKeywords(clueId);
    if (!Array.isArray(this.state.circled[clueId])) this.state.circled[clueId] = [];
    var arr = this.state.circled[clueId];
    if (total.indexOf(kw) !== -1 && arr.indexOf(kw) === -1) arr.push(kw);
    var circled = total.filter(function (k) { return arr.indexOf(k) !== -1; }).length;
    var complete = total.length > 0 && circled >= total.length;
    this.save();
    return { circled: circled, total: total.length, complete: complete };
  };

  /* 某线索的圈选进度（供探查提示显示「还差几处」） */
  CaseEngine.prototype.getKeywordProgress = function (clueId) {
    var total = this.getClueKeywords(clueId);
    var arr = this.state.circled[clueId] || [];
    var done = total.filter(function (k) { return arr.indexOf(k) !== -1; }).length;
    return { circled: done, total: total.length, remaining: total.length - done };
  };

  CaseEngine.prototype.markDocRead = function (id) {
    if (this.state.readDocs.indexOf(id) === -1) {
      this.state.readDocs.push(id);
      this.save();
    }
  };

  /* 回答推理议题，返回 { ok, finding?, script?, message? } */
  CaseEngine.prototype.answerQuestion = function (qid, cardIds) {
    var q = this.getQuestion(qid);
    if (!q) return { ok: false, message: '题目不存在' };
    if (this.state.solved.indexOf(qid) !== -1) return { ok: false, message: '该议题已经解决' };

    var answer = q.answer || [];
    var selected = {};
    (cardIds || []).forEach(function (id) { selected[id] = true; });
    var correct = answer.length === (cardIds || []).length && answer.every(function (id) { return selected[id]; });

    if (correct) {
      this.state.solved.push(qid);
      this.save();
      return {
        ok: true,
        question: q,
        finding: this.getFinding(q.on_correct.finding),
        script: q.on_correct.script || []
      };
    }

    /* 答错分级：第一次不透露方向（防穷举），第二次起显示剧本引导语 */
    this.state.mistakes += 1;
    this.state.wrongAttempts[qid] = (this.state.wrongAttempts[qid] || 0) + 1;
    this.save();
    var attempts = this.state.wrongAttempts[qid];
    return {
      ok: false,
      attempts: attempts,
      message: attempts === 1
        ? '这组材料无法构成有效的推理。'
        : ((q.on_wrong && q.on_wrong.message) || '这组材料不能构成有效的推理。')
    };
  };

  /* 使用提示 */
  CaseEngine.prototype.useHint = function (qid) {
    var q = this.getQuestion(qid);
    this.state.hintsUsed += 1;
    this.save();
    return (q && q.hint) || '这个议题似乎不需要提示。';
  };

  /* 结案条件（所需结论是否齐全） */
  CaseEngine.prototype.canAccuse = function () {
    var self = this;
    var req = this.data.accusation.required_findings || [];
    return req.every(function (id) { return self.hasFinding(id); });
  };

  /* 提交结案，返回 { ok, message?, script?, culpritOk?, findingsOk? } */
  CaseEngine.prototype.accuse = function (charId, findingIds) {
    var acc = this.data.accusation;
    var self = this;
    var req = acc.required_findings || [];
    var selected = {};
    (findingIds || []).forEach(function (id) { selected[id] = true; });
    var culpritOk = charId === acc.culprit;
    var findingsOk = req.every(function (id) { return selected[id]; });

    if (culpritOk && findingsOk) {
      this.state.finished = true;
      this.save();
      return { ok: true, script: acc.on_correct.script };
    }

    /* 结案失败同样分级：第一次只告知不成立 */
    this.state.mistakes += 1;
    this.state.wrongAttempts.__accusation__ = (this.state.wrongAttempts.__accusation__ || 0) + 1;
    this.save();
    var attempts = this.state.wrongAttempts.__accusation__;
    return {
      ok: false,
      attempts: attempts,
      culpritOk: culpritOk,
      findingsOk: findingsOk,
      message: attempts === 1
        ? '指控不成立——法庭在等待完整的真相。'
        : ((acc.on_wrong && acc.on_wrong.message) || '法庭不接受没有证据链支撑的指控。'),
      script: (acc.on_wrong && acc.on_wrong.script) || []
    };
  };

  /* 评分：S / A / B / C */
  CaseEngine.prototype.getRank = function () {
    var score = this.state.mistakes + this.state.hintsUsed;
    if (score <= 2) return 'S';
    if (score <= 5) return 'A';
    if (score <= 8) return 'B';
    return 'C';
  };

  CaseEngine.prototype.getPlayMinutes = function () {
    return Math.max(1, Math.round((Date.now() - (this.state.startedAt || Date.now())) / 60000));
  };

  /* 存档 */
  CaseEngine.prototype.save = function () {
    try {
      localStorage.setItem(SAVE_PREFIX + this.data.case.id, JSON.stringify(this.state));
    } catch (e) { /* 存储不可用时静默 */ }
  };

  CaseEngine.loadSave = function (caseId) {
    try {
      var raw = localStorage.getItem(SAVE_PREFIX + caseId);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };

  CaseEngine.clearSave = function (caseId) {
    try { localStorage.removeItem(SAVE_PREFIX + caseId); } catch (e) {}
  };

  /* ---------------------------------------------------------
     导入剧本存储（localStorage）
     --------------------------------------------------------- */
  var ImportStore = {
    list: function () {
      try {
        var raw = localStorage.getItem(IMPORT_KEY);
        var arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
      } catch (e) { return []; }
    },
    upsert: function (data) {
      var list = ImportStore.list();
      var idx = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].case && data.case && list[i].case.id === data.case.id) { idx = i; break; }
      }
      if (idx >= 0) list[idx] = data; else list.push(data);
      try { localStorage.setItem(IMPORT_KEY, JSON.stringify(list)); } catch (e) {}
    },
    remove: function (caseId) {
      var list = ImportStore.list().filter(function (d) {
        return !(d && d.case && d.case.id === caseId);
      });
      try { localStorage.setItem(IMPORT_KEY, JSON.stringify(list)); } catch (e) {}
    }
  };

  /* 导出 */
  var API = {
    FORMAT_VERSION: FORMAT_VERSION,
    validateCase: validateCase,
    CaseEngine: CaseEngine,
    ImportStore: ImportStore
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.NZCP = API;
})(typeof window !== 'undefined' ? window : this);
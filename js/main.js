/* =========================================================
   NZCP Main — 应用控制器
   职责：案件加载与选择 / 阅读流程 / 摘录 / 线索板推理 / 结案 / 结算 / 导入
   ========================================================= */
(function () {
  'use strict';

  var Engine = window.NZCP;
  var UI = window.NZCP_UI;
  var el = UI.el;

  var App = {
    cases: [],
    engine: null,
    currentDocId: null,
    activeQuestion: null,
    selectedCards: [],
    knownDocs: null,
    accuseSel: { suspect: null, findings: [] }
  };

  /* ============ 初始化 ============ */
  function init() {
    bindStaticEvents();
    loadCases();
    // 窗口尺寸变化时重算已收录印章的行末避让（防抖）
    var rsTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(rsTimer);
      rsTimer = setTimeout(function () { UI.positionStamps(); }, 200);
    });
  }

  async function loadCases() {
    var list = [];

    // 1) 内置案件（cases/index.json → 各案件文件）
    try {
      var idxResp = await fetch('cases/index.json', { cache: 'no-store' });
      if (idxResp.ok) {
        var idx = await idxResp.json();
        var files = (idx && idx.files) || [];
        for (var i = 0; i < files.length; i++) {
          try {
            var r = await fetch('cases/' + files[i], { cache: 'no-store' });
            if (!r.ok) { console.warn('读取内置剧本失败：', files[i]); continue; }
            var data = await r.json();
            var v = Engine.validateCase(data);
            if (v.errors.length) {
              console.warn('内置剧本校验失败：', files[i], v.errors);
            } else {
              list.push({ data: data, source: 'builtin' });
            }
          } catch (e) { console.warn('读取内置剧本出错：', files[i], e); }
        }
      }
    } catch (e) {
      console.warn('案件索引加载失败（请通过 http 服务打开，或使用导入功能）', e);
    }

    // 2) 用户导入的案件
    Engine.ImportStore.list().forEach(function (data) {
      try {
        var v = Engine.validateCase(data);
        if (v.errors.length) return;
        var dup = list.some(function (item) { return item.data.case.id === data.case.id; });
        if (!dup) list.push({ data: data, source: 'import' });
      } catch (e) { /* 跳过损坏的导入数据 */ }
    });

    App.cases = list;
    UI.renderCaseList(list, { onStart: startCase });
  }

  /* ============ 开始案件 ============ */
  async function startCase(data) {
    var save = Engine.CaseEngine.loadSave(data.case.id);
    if (save && save.finished) {
      if (!confirm('该案件已经解决过了。要重新开始调查吗？（旧存档将被清除）')) return;
      Engine.CaseEngine.clearSave(data.case.id);
      save = null;
    }

    App.engine = new Engine.CaseEngine(data, save || null);
    App.currentDocId = null;
    App.activeQuestion = null;
    App.selectedCards = [];
    App.accuseSel = { suspect: null, findings: [] };
    App.knownDocs = new Set(data.documents.filter(function (d) {
      return App.engine.isDocAvailable(d);
    }).map(function (d) { return d.id; }));

    UI.showScreen('screen-game');
    UI.renderHUD(App.engine);
    UI.renderDocList(App.engine, null);
    UI.renderDoc(App.engine, null);

    // 全新开始：播放序章
    var st = App.engine.state;
    var isFresh = !st.readDocs.length && !st.extracted.length && !st.solved.length;
    if (isFresh && data.case.prologue && data.case.prologue.length) {
      await UI.playScript(data.case.prologue, data);
    }

    // 自动打开第一份可用文档
    var firstDoc = data.documents.filter(function (d) { return App.engine.isDocAvailable(d); })[0];
    if (firstDoc) selectDoc(firstDoc.id);
  }

  /* ============ 阅读流程 ============ */
  function selectDoc(docId) {
    var eng = App.engine;
    if (!eng) return;
    var doc = eng.getDoc(docId);
    if (!doc) return;
    if (!eng.isDocAvailable(doc)) {
      UI.toast('该卷宗尚未入档 —— 继续推进推理议题，新的证据会自动补充进来。', 'error');
      return;
    }
    App.currentDocId = docId;
    UI.renderDoc(eng, doc);
    eng.markDocRead(docId);
    UI.renderDocList(eng, docId);
    UI.renderHUD(eng);
  }

  /* 深挖段落：展开隐藏内容（保持阅读位置） */
  function openDig(docId, blockIdx) {
    var eng = App.engine;
    if (!eng || docId == null || isNaN(blockIdx)) return;
    eng.openDig(docId, blockIdx);
    UI.flashSaveFlag();
    var reader = el('docReader');
    var keepScroll = reader ? reader.scrollTop : 0;
    var doc = eng.getDoc(docId);
    UI.renderDoc(eng, doc);
    if (reader) reader.scrollTop = keepScroll;
    UI.renderDocList(eng, docId);
    UI.renderHUD(eng);
    UI.toast('深挖有了新收获——注意这段补充材料。', 'ok');
  }

  /* 关键词圈选摘录：点中一个字眼只圈这一处；圈齐该线索全部字眼后才摘录入板 */
  function extractKeyword(clueId, hotEl) {
    var eng = App.engine;
    if (!eng) return;
    var clue = eng.getClue(clueId);
    if (!clue) return;
    if (clue.initial === true) return;
    if (eng.state.extracted.indexOf(clueId) !== -1) return;

    var kw = hotEl.getAttribute('data-kw') || hotEl.textContent;
    var prog = eng.circleKeyword(clueId, kw);
    UI.flashSaveFlag();

    var block = hotEl.closest('.clue-source');
    if (block) {
      // 仅圈选本次点中的这个字眼（同一字眼的多处出现一并圈定）
      var spans = block.querySelectorAll('.kw-hot[data-clue="' + clueId + '"]');
      for (var i = 0; i < spans.length; i++) {
        var sp = spans[i];
        if (sp.getAttribute('data-kw') === kw) {
          sp.classList.remove('kw-hot');
          sp.classList.add('kw-found');
          if (!sp.querySelector('.kw-ring')) {
            sp.insertAdjacentHTML('beforeend', UI.kwCircle(true));
          }
        }
      }
    }

    if (prog.complete) {
      eng.extractClue(clueId);
      // 小印章已随块渲染就位（正文容器 kw-wrap 内、absolute 定位行末），.extracted 控制显隐；
      // 智能避让：末行排满时下移到段落右下角，绝不压字
      if (block) block.classList.add('extracted');
      UI.positionStamps();
      UI.toast('（圈齐了！）关键处全部圈定——已收录线索「' + clue.label + '」', 'ok');
      UI.renderDocList(eng, App.currentDocId);
      UI.renderHUD(eng);
    } else {
      UI.toast('（圈出一处 ' + prog.circled + '/' + prog.total + '）这句话里，还有没圈到的字眼', 'ok');
    }
  }

  /* 圈选段落探查提示：按圈选进度给出引导（不剧透是哪个词） */
  function showProbeNote(blockEl) {
    if (blockEl.classList.contains('extracted')) return;
    var msg = '〔这句话里，有值得用红笔圈出的字眼〕';
    var eng = App.engine;
    var clueId = blockEl.getAttribute('data-clue');
    if (eng && clueId && eng.state.extracted.indexOf(clueId) === -1) {
      var p = eng.getKeywordProgress(clueId);
      if (p.circled > 0 && p.remaining > 0) {
        msg = '〔已圈 ' + p.circled + ' 处——这句里还有 ' + p.remaining + ' 处没圈到〕';
      }
    }
    var note = blockEl.querySelector('.probe-note');
    if (!note) {
      note = document.createElement('div');
      note.className = 'probe-note';
      blockEl.appendChild(note);
    }
    note.textContent = msg;
    note.classList.add('show');
    if (note.__hideTimer) clearTimeout(note.__hideTimer);
    note.__hideTimer = setTimeout(function () { note.classList.remove('show'); }, 2600);
  }

  function extractClue(clueId, element) {
    var eng = App.engine;
    if (!eng) return;
    var clue = eng.getClue(clueId);
    if (!clue) return;
    if (clue.initial === true) {
      UI.toast('这条线索已经在线索板上了。');
      return;
    }
    if (eng.state.extracted.indexOf(clueId) !== -1) return;

    eng.extractClue(clueId);
    UI.flashSaveFlag();

    // 隐藏线索的发现感：与普通摘录区分反馈
    var isHidden = element && element.classList.contains('hidden-clue');
    UI.toast(isHidden
      ? '（注意到了！）这一句值得单独记录——已收录「' + clue.label + '」'
      : '已摘录线索「' + clue.label + '」', 'ok');

    // 局部更新阅读区（保留滚动位置），而非整页重渲染
    if (element) {
      element.classList.add('extracted');
      var tag = element.querySelector('.extract-tag');
      if (tag) tag.textContent = '已收录';
    }
    UI.renderDocList(eng, App.currentDocId);
    UI.renderHUD(eng);
  }

  /* ============ 线索板 ============ */
  function openBoard() {
    if (!App.engine) return;
    App.activeQuestion = null;
    App.selectedCards = [];
    refreshUnlocks();
    renderBoardScreen();
    UI.showScreen('screen-board');
  }

  function backToDossier() {
    UI.showScreen('screen-game');
    if (App.engine) {
      UI.renderDocList(App.engine, App.currentDocId);
      UI.renderHUD(App.engine);
      var doc = App.engine.getDoc(App.currentDocId);
      UI.renderDoc(App.engine, doc);
    }
  }

  function renderBoardScreen() {
    var eng = App.engine;
    UI.renderBoard(eng, App.activeQuestion, App.selectedCards);
    var q = App.activeQuestion ? eng.getQuestion(App.activeQuestion) : null;
    UI.renderDeduction(eng, q, App.selectedCards);
    UI.renderHUD(eng);
  }

  function selectQuestion(qid) {
    var eng = App.engine;
    var q = eng.getQuestion(qid);
    if (!q) return;
    if (eng.state.solved.indexOf(qid) !== -1) {
      UI.toast('这个议题已经解决了。');
      return;
    }
    if (!eng.isQuestionAvailable(q)) {
      var miss = eng.getQuestionMissing(q);
      UI.toast(q.locked_hint || ('依据不足 —— 还缺 ' + miss.total + ' 条线索或结论。继续查阅案宗，把线索摘录到线索板上。'));
      return;
    }
    if (App.activeQuestion === qid) {
      App.activeQuestion = null;
      App.selectedCards = [];
      renderBoardScreen();
      return;
    }
    App.activeQuestion = qid;
    App.selectedCards = [];
    renderBoardScreen();
  }

  function toggleCard(cardId) {
    var eng = App.engine;
    if (!App.activeQuestion) {
      var card = eng.getBoardCards().filter(function (c) { return c.id === cardId; })[0];
      if (card) UI.toast(card.label + '：' + card.text);
      return;
    }
    var i = App.selectedCards.indexOf(cardId);
    if (i >= 0) {
      App.selectedCards.splice(i, 1);
    } else {
      if (App.selectedCards.length >= 4) {
        UI.toast('一次最多选择 4 条推理材料。');
        return;
      }
      App.selectedCards.push(cardId);
    }
    renderBoardScreen();
  }

  async function submitDeduction() {
    var eng = App.engine;
    if (!App.activeQuestion) return;
    if (!App.selectedCards.length) {
      UI.toast('请先选择推理材料。', 'error');
      return;
    }
    var qid = App.activeQuestion;
    var result = eng.answerQuestion(qid, App.selectedCards);
    UI.renderHUD(eng);
    UI.flashSaveFlag();

    if (result.ok) {
      App.activeQuestion = null;
      App.selectedCards = [];
      UI.renderBoard(eng, null, []);
      UI.renderDeduction(eng, null, []);
      if (result.script && result.script.length) {
        await UI.playScript(result.script, eng.data);
      }
      if (result.finding) {
        UI.toast('获得结论「' + result.finding.label + '」', 'ok');
      }
      refreshUnlocks();
      if (eng.canAccuse()) {
        UI.toast('结案条件已达成 —— 可以提交结案陈词了。', 'ok');
      }
      renderBoardScreen();
    } else {
      var bar = el('deductionActive');
      if (bar) {
        bar.classList.add('wrong-shake');
        setTimeout(function () { bar.classList.remove('wrong-shake'); }, 480);
      }
      UI.toast(result.message, 'error');
    }
  }

  function useHint() {
    if (!App.activeQuestion) return;
    var msg = App.engine.useHint(App.activeQuestion);
    UI.toast('提示：' + msg);
    UI.renderHUD(App.engine);
    UI.flashSaveFlag();
  }

  function refreshUnlocks() {
    var eng = App.engine;
    if (!eng) return;
    var now = eng.data.documents.filter(function (d) { return eng.isDocAvailable(d); })
      .map(function (d) { return d.id; });
    if (!App.knownDocs) { App.knownDocs = new Set(now); return; }
    var fresh = now.filter(function (id) { return !App.knownDocs.has(id); });
    if (fresh.length) {
      var names = fresh.map(function (id) {
        var d = eng.getDoc(id);
        return d ? d.title : id;
      }).join('、');
      UI.toast('新卷宗已入档：' + names, 'ok');
    }
    App.knownDocs = new Set(now);
  }

  /* ============ 结案 ============ */
  function openAccuse() {
    var eng = App.engine;
    if (!eng) return;
    if (!eng.canAccuse()) {
      UI.toast('证据链还不完整 —— 完成主线推理议题后再来结案。', 'error');
      return;
    }
    App.accuseSel = { suspect: null, findings: [] };
    UI.renderAccuseModal(eng, null, []);
    el('accuseModal').classList.remove('hidden');
  }

  function selectSuspect(id) {
    App.accuseSel.suspect = id;
    UI.renderAccuseModal(App.engine, App.accuseSel.suspect, App.accuseSel.findings);
  }

  function toggleFinding(id) {
    var arr = App.accuseSel.findings;
    var i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(id);
    UI.renderAccuseModal(App.engine, App.accuseSel.suspect, App.accuseSel.findings);
  }

  async function submitAccuse() {
    var eng = App.engine;
    var sel = App.accuseSel;
    if (!sel.suspect) {
      UI.toast('请先指认一名嫌疑人。', 'error');
      return;
    }
    if (!sel.findings.length) {
      UI.toast('请至少勾选一条支撑结论。', 'error');
      return;
    }

    var res = eng.accuse(sel.suspect, sel.findings);
    UI.renderHUD(eng);
    UI.flashSaveFlag();

    if (res.ok) {
      el('accuseModal').classList.add('hidden');
      if (res.script && res.script.length) {
        await UI.playScript(res.script, eng.data);
      }
      if (eng.data.case.epilogue && eng.data.case.epilogue.length) {
        await UI.playScript(eng.data.case.epilogue, eng.data);
      }
      UI.renderResultModal(eng);
      el('resultModal').classList.remove('hidden');
    } else {
      UI.toast(res.message, 'error');
      if (res.script && res.script.length) {
        el('accuseModal').classList.add('hidden');
        await UI.playScript(res.script, eng.data);
        UI.renderAccuseModal(eng, sel.suspect, sel.findings);
        el('accuseModal').classList.remove('hidden');
      }
    }
  }

  function backToTitle() {
    el('resultModal').classList.add('hidden');
    App.engine = null;
    App.currentDocId = null;
    App.activeQuestion = null;
    App.selectedCards = [];
    UI.showScreen('screen-title');
    loadCases();
  }

  /* 游戏内中途返回案件库（存档自动落盘，无损退出；回首页后案件卡显示「继 续」） */
  function exitToTitle() {
    backToTitle();
    UI.toast('调查进度已自动保存——「继 续」随时接着查', 'ok');
  }

  /* ============ 导入剧本 ============ */
  async function handleImport(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      var text = await file.text();
      var data = JSON.parse(text);
      var v = Engine.validateCase(data);
      if (v.errors.length) {
        console.error('剧本校验失败：', v.errors);
        UI.toast('剧本校验失败：' + v.errors[0] +
          (v.errors.length > 1 ? '（共 ' + v.errors.length + ' 个错误，详见控制台）' : ''), 'error');
        return;
      }
      Engine.ImportStore.upsert(data);
      UI.toast('剧本《' + data.case.title + '》导入成功！', 'ok');
      loadCases();
    } catch (err) {
      UI.toast('导入失败：' + (err && err.message ? err.message : 'JSON 解析错误'), 'error');
    } finally {
      e.target.value = '';
    }
  }

  /* ============ 新建剧本（粘贴 JSON 导入） ============ */
  function openCreateModal() {
    el('pasteArea').value = '';
    el('pasteHint').textContent = '校验通过即上架本机案件库（浏览器本地保存，刷新不丢）';
    el('createModal').classList.remove('hidden');
    setTimeout(function () { el('pasteArea').focus(); }, 50);
  }

  function handlePasteImport() {
    var text = el('pasteArea').value.trim();
    if (!text) { UI.toast('请先粘贴剧本 JSON 文本', 'error'); return; }
    try {
      var data = JSON.parse(text);
      var v = Engine.validateCase(data);
      if (v.errors.length) {
        console.error('剧本校验失败：', v.errors);
        el('pasteHint').textContent = '校验失败：' + v.errors[0] +
          (v.errors.length > 1 ? '（共 ' + v.errors.length + ' 个错误，按 F12 看控制台全部报错）' : '');
        UI.toast('剧本校验失败：' + v.errors[0], 'error');
        return;
      }
      Engine.ImportStore.upsert(data);
      el('createModal').classList.add('hidden');
      UI.toast('剧本《' + data.case.title + '》已加入案件库！', 'ok');
      loadCases();
    } catch (err) {
      UI.toast('JSON 解析失败：' + (err && err.message ? err.message : '格式错误'), 'error');
    }
  }

  /* ============ 事件绑定 ============ */
  function bindStaticEvents() {
    el('docList').addEventListener('click', function (e) {
      var item = e.target.closest('.doc-item');
      if (!item) return;
      selectDoc(item.getAttribute('data-doc-id'));
    });

    el('docReader').addEventListener('click', function (e) {
      var digBtn = e.target.closest('.dig-btn');
      if (digBtn) {
        var digBlock = digBtn.closest('.blk.dig-block');
        if (digBlock && digBlock.classList.contains('opened')) return;
        var blockIdx = parseInt(digBlock.getAttribute('data-dig-idx'), 10);
        openDig(App.currentDocId, blockIdx);
        return;
      }
      // 关键词圈选：点中关键字眼 → 红笔圈选摘录
      var kwHot = e.target.closest('.kw-hot');
      if (kwHot) {
        extractKeyword(kwHot.getAttribute('data-clue'), kwHot);
        return;
      }
      // 圈选段落本体（未点中关键词）：探查提示，不直接摘录
      var kwBlock = e.target.closest('.kw-block');
      if (kwBlock) {
        showProbeNote(kwBlock);
        return;
      }
      var src = e.target.closest('.clue-source');
      if (!src) return;
      if (src.classList.contains('extracted')) return;
      extractClue(src.getAttribute('data-clue'), src);
    });

    el('boardCards').addEventListener('click', function (e) {
      var card = e.target.closest('.clue-card');
      if (!card) return;
      toggleCard(card.getAttribute('data-card-id'));
    });

    el('questionList').addEventListener('click', function (e) {
      var item = e.target.closest('.question-item');
      if (!item) return;
      selectQuestion(item.getAttribute('data-qid'));
    });

    el('dedSlot').addEventListener('click', function (e) {
      var x = e.target.closest('.chip-x');
      if (!x) return;
      e.stopPropagation();
      var id = x.getAttribute('data-chip-id');
      var i = App.selectedCards.indexOf(id);
      if (i >= 0) App.selectedCards.splice(i, 1);
      renderBoardScreen();
    });

    el('suspectGrid').addEventListener('click', function (e) {
      var card = e.target.closest('.suspect-card');
      if (!card) return;
      selectSuspect(card.getAttribute('data-suspect-id'));
    });

    el('findingGrid').addEventListener('click', function (e) {
      var item = e.target.closest('.finding-item');
      if (!item) return;
      toggleFinding(item.getAttribute('data-finding-id'));
    });

    el('btnBoard').addEventListener('click', openBoard);
    el('btnQuestions').addEventListener('click', openBoard);
    el('btnBackDossier').addEventListener('click', backToDossier);
    el('btnAccuse').addEventListener('click', openAccuse);
    el('btnAccuse2').addEventListener('click', openAccuse);
    el('btnSubmitDeduction').addEventListener('click', submitDeduction);
    el('btnHint').addEventListener('click', useHint);
    el('btnSubmitAccuse').addEventListener('click', submitAccuse);
    el('btnCloseAccuse').addEventListener('click', function () {
      el('accuseModal').classList.add('hidden');
    });
    el('btnBackTitle').addEventListener('click', exitToTitle);
    el('btnBackTitle2').addEventListener('click', exitToTitle);
    el('importFile').addEventListener('change', handleImport);
    el('btnCreateCase').addEventListener('click', openCreateModal);
    el('btnCloseCreate').addEventListener('click', function () {
      el('createModal').classList.add('hidden');
    });
    el('btnPasteImport').addEventListener('click', handlePasteImport);

    // ESC 关闭弹层（结案 / 新建剧本）
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        el('accuseModal').classList.add('hidden');
        el('createModal').classList.add('hidden');
      }
    });
  }

  /* ============ 启动 ============ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
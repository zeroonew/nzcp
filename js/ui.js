/* =========================================================
   NZCP UI — 渲染与演出层
   职责：案宗阅读 / 线索板 / 推理栏 / 对话演出 / 模态 / Toast
   所有交互事件统一由 main.js 通过事件委托绑定
   ========================================================= */
(function (global) {
  'use strict';

  var DOC_TYPE_META = {
    record: '笔录 · 登记',
    testimony: '证 词',
    report: '报 告',
    photo: '照片 · 证物',
    letter: '信 件',
    news: '报 道',
    other: '文 书'
  };

  var CAT_META = {
    physical: '物证',
    testimony: '证词',
    background: '背景',
    deduction: '推论'
  };

  function el(id) { return document.getElementById(id); }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function lockIcon() {
    return '<svg class="di-lock" width="13" height="15" viewBox="0 0 13 15" fill="none">' +
      '<rect x="1" y="6" width="11" height="8" rx="1.6" stroke="currentColor" stroke-width="1.4"/>' +
      '<path d="M3.5 6V4.6a3 3 0 0 1 6 0V6" stroke="currentColor" stroke-width="1.4"/></svg>';
  }

  /* 红笔圈选 SVG：手绘风椭圆路径（带笔触重叠收尾），animate=true 时描画动画 */
  function redCircleSvg(animate) {
    return '<svg class="kw-ring' + (animate ? ' anim' : ' static') + '" viewBox="0 0 100 42" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="M9 22 C7 10 30 4 52 5 C78 6 95 12 94 21 C93 32 72 38 47 37 C23 36 10 32 9 22 C8.5 17 13 13 17 12" pathLength="100"/></svg>';
  }

  /* 关键词圈选：把 text 中出现的 keywords 包成可点击 span（对 escapeHtml 后的文本匹配）。
     - 每个字眼独立成 span（重叠区间取最长匹配，避免嵌套）
     - found = 线索已摘录 或 该字眼已被玩家圈选（支持部分圈选的混合态）
     （已收录小印章不再注入字眼内，由 renderBlock 直接拼到外层块末，钉在段落末行行末） */
  function wrapKeywordText(text, keywords, clueId, circledSet, extracted) {
    var escaped = escapeHtml(text == null ? '' : text);
    var intervals = [];
    (keywords || []).forEach(function (k) {
      if (typeof k !== 'string' || !k) return;
      var ek = escapeHtml(k);
      if (!ek) return;
      var idx = 0;
      while ((idx = escaped.indexOf(ek, idx)) !== -1) {
        intervals.push({ s: idx, e: idx + ek.length, kw: k });
        idx += ek.length;
      }
    });
    if (!intervals.length) return escaped;
    intervals.sort(function (a, b) { return a.s - b.s || (b.e - b.s) - (a.e - a.s); });
    var taken = [];
    var kept = [];
    intervals.forEach(function (it) {
      var overlap = taken.some(function (t) { return it.s < t.e && it.e > t.s; });
      if (overlap) return;
      taken.push(it);
      kept.push(it);
    });
    kept.sort(function (a, b) { return a.s - b.s; });
    var out = '';
    var pos = 0;
    kept.forEach(function (it, ki) {
      out += escaped.slice(pos, it.s);
      var found = extracted || (circledSet && circledSet.indexOf(it.kw) !== -1);
      out += '<span class="' + (found ? 'kw-found' : 'kw-hot') + '" data-clue="' + escapeHtml(clueId) +
        '" data-kw="' + escapeHtml(it.kw) + '">' +
        escaped.slice(it.s, it.e) +
        (found ? redCircleSvg(false) : '') +
      '</span>';
      pos = it.e;
    });
    out += escaped.slice(pos);
    return out;
  }

  /* ============ 屏幕切换 ============ */
  function showScreen(id) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.toggle('active', screens[i].id === id);
    }
  }

  /* ============ 案件列表 ============ */
  function renderCaseList(cases, handlers) {
    var wrap = el('caseList');
    if (!cases || !cases.length) {
      wrap.innerHTML = '<div class="board-empty" style="color:#8d7f61;">案件库为空 —— 请先导入 .json 剧本</div>';
      return;
    }
    var html = cases.map(function (item, idx) {
      var d = item.data;
      var c = d.case;
      var save = window.NZCP.CaseEngine.loadSave(c.id);
      var stars = '';
      var diff = Math.max(1, Math.min(5, c.difficulty || 1));
      for (var s = 1; s <= 5; s++) stars += (s <= diff ? '★' : '☆');
      var saveHint = '';
      var goText = '开始调查';
      var goClass = '';
      if (save && save.finished) { saveHint = '已解决 · 点击可重玩'; goText = '再 战'; goClass = ' done'; }
      else if (save && (save.extracted.length || save.solved.length || save.readDocs.length)) {
        saveHint = '有未完成的调查 · 点击继续';
        goText = '继 续';
      }
      return '<div class="case-card" data-case-idx="' + idx + '">' +
        '<div class="cc-episode">' + escapeHtml(c.episode || '') + '</div>' +
        '<div class="cc-main">' +
          '<div class="cc-title">' + escapeHtml(c.title) + '</div>' +
          '<div class="cc-sub">' + escapeHtml(c.subtitle || '') + '</div>' +
          '<div class="cc-summary">' + escapeHtml(c.summary || '') + '</div>' +
          '<div class="cc-meta">' +
            '<span>难度 ' + stars + '</span>' +
            '<span>' + escapeHtml(c.play_time || '时长未知') + '</span>' +
            '<span>' + escapeHtml(c.author || '佚名') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="cc-go' + goClass + '">' + goText + '</div>' +
        (saveHint ? '<div class="cc-save-hint">' + saveHint + '</div>' : '') +
      '</div>';
    }).join('');
    wrap.innerHTML = html;

    // 事件委托
    wrap.onclick = function (e) {
      var card = e.target.closest('.case-card');
      if (!card) return;
      var idx = parseInt(card.getAttribute('data-case-idx'), 10);
      if (handlers && handlers.onStart) handlers.onStart(cases[idx].data);
    };
  }

  /* ============ 卷宗目录 ============ */
  function renderDocList(engine, currentDocId) {
    var list = el('docList');
    var html = engine.data.documents.map(function (doc) {
      var available = engine.isDocAvailable(doc);
      var read = engine.state.readDocs.indexOf(doc.id) !== -1;
      var fresh = engine.docHasNewClues(doc);
      var active = doc.id === currentDocId;
      var no = (doc.meta && doc.meta.no) ? doc.meta.no : '';
      var cls = 'doc-item' + (active ? ' active' : '') + (available ? '' : ' locked');
      var iconCls = 'di-icon t-' + (doc.type || 'other');
      var statusHtml = '';
      if (!available) statusHtml = '<span class="di-status">' + lockIcon() + '</span>';
      else if (fresh) statusHtml = '<span class="di-status st-fresh">新线索</span>';
      else if (read) statusHtml = '<span class="di-status">已阅</span>';
      return '<div class="' + cls + '" data-doc-id="' + escapeHtml(doc.id) + '">' +
        '<div class="' + iconCls + '"></div>' +
        '<div class="di-main">' +
          '<div class="di-title">' + escapeHtml(available ? doc.title : '未解锁文档') + '</div>' +
          '<div class="di-no">' + escapeHtml(no) + '</div>' +
        '</div>' + statusHtml +
      '</div>';
    }).join('');
    list.innerHTML = html;

    var total = engine.data.documents.length;
    var readCount = engine.data.documents.filter(function (d) {
      return engine.isDocAvailable(d) && engine.state.readDocs.indexOf(d.id) !== -1;
    }).length;
    el('docProgress').textContent = readCount + ' / ' + total + ' 份已阅';
  }

  /* ============ 渲染文档 ============ */
  function renderDoc(engine, doc) {
    var reader = el('docReader');
    if (!doc) {
      reader.innerHTML = '<div class="reader-empty"><p>从左侧目录选择一份卷宗开始阅读</p>' +
        '<p class="reader-empty-sub">正文中左侧带金线的段落，可以点击「摘录」为线索</p></div>';
      return;
    }

    var meta = doc.meta || {};
    var typeLabel = DOC_TYPE_META[doc.type] || DOC_TYPE_META.other;
    var metaLine = [];
    if (meta.no) metaLine.push('编号 ' + escapeHtml(meta.no));
    if (meta.author) metaLine.push('出具 ' + escapeHtml(meta.author));
    if (meta.date) metaLine.push(escapeHtml(meta.date));

    var bodyHtml = (doc.blocks || []).map(function (b, bi) {
      return renderBlock(engine, b, doc, bi);
    }).join('');

    reader.innerHTML =
      '<div class="doc-sheet">' +
        '<div class="binding-holes"><i></i><i></i></div>' +
        '<div class="doc-head">' +
          '<div class="doc-type-tag">' + typeLabel + '</div>' +
          '<div class="doc-title">' + escapeHtml(doc.title) + '</div>' +
          '<div class="doc-meta-line">' + metaLine.map(function (m) { return '<span>' + m + '</span>'; }).join('') + '</div>' +
          (meta.stamp ? '<div class="doc-stamp">' + escapeHtml(meta.stamp) + '</div>' : '') +
        '</div>' +
        '<div class="doc-body">' + bodyHtml + '</div>' +
      '</div>';
    reader.scrollTop = 0;
    positionStamps(reader);
  }

  /* 已收录印章的智能避让：末行右侧留白足够 → 行内行末（CSS 默认 bottom:1px）；
     末行恰好排满 → 印章下移到段落右下角（style.bottom 置负），绝不压住正文。
     在 renderDoc 之后、圈选收录完成后、窗口 resize 时调用 */
  function positionStamps(root) {
    var scope = root || document;
    if (!scope.querySelectorAll) return;
    var blocks = scope.querySelectorAll('.kw-block.extracted');
    for (var i = 0; i < blocks.length; i++) {
      var blk = blocks[i];
      var t = blk.querySelector('.kw-stamp');
      var wrap = blk.querySelector('.kw-wrap');
      if (!t || !wrap) continue;
      t.style.bottom = '';   // 复位为 CSS 默认（行内行末），再按需下移
      var wr = wrap.getBoundingClientRect();
      var tr = t.getBoundingClientRect();
      // 实测末行（y 最深的文本行）的右缘
      var walker = document.createTreeWalker(wrap, NodeFilter.SHOW_TEXT);
      var lastTop = -1, lastRight = -1, node;
      while ((node = walker.nextNode())) {
        if (t.contains(node)) continue;
        var r = document.createRange();
        r.selectNodeContents(node);
        var rects = r.getClientRects();
        for (var j = 0; j < rects.length; j++) {
          var rc = rects[j];
          if (rc.width < 1) continue;
          if (rc.top > lastTop + 2) { lastTop = rc.top; lastRight = rc.right; }
          else if (Math.abs(rc.top - lastTop) <= 2 && rc.right > lastRight) lastRight = rc.right;
        }
      }
      if (lastTop < 0) continue;
      var free = wr.right - lastRight;
      if (free < tr.width + 8) t.style.bottom = (-(Math.round(tr.height) + 6)) + 'px';
    }
  }

  function renderBlock(engine, b, doc, blockIdx) {
    if (!b || !b.type) return '';
    var self = this;

    /* 深挖块：点击「深入调查」展开隐藏段落（威慑逼供式的深挖质询） */
    if (b.type === 'dig') {
      if (engine.isDigOpened(doc.id, blockIdx)) {
        var revealHtml = (b.reveal || []).map(function (rb) {
          return renderBlock(engine, rb, doc, blockIdx + 'r');
        }).join('');
        return '<div class="blk dig-block opened">' +
          '<div class="dig-text">' + escapeHtml(b.text || '') + '</div>' +
          '<span class="dig-mark">已深入调查</span>' +
          '<div class="dig-reveal">' + revealHtml + '</div>' +
        '</div>';
      }
      return '<div class="blk dig-block" data-dig-idx="' + blockIdx + '">' +
        '<div class="dig-text">' + escapeHtml(b.text || '') + '</div>' +
        '<button class="dig-btn">深入调查</button>' +
      '</div>';
    }

    var inner = '';
    switch (b.type) {
      case 'heading':
        return '<div class="blk heading">' + escapeHtml(b.text || '') + '</div>';
      case 'para':
        inner = '<div class="blk para">' + escapeHtml(b.text || '') + '</div>';
        break;
      case 'quote':
        inner = '<div class="blk quote">' + escapeHtml(b.text || '') + '</div>';
        break;
      case 'list':
        inner = '<div class="blk list"><ul>' +
          (b.items || []).map(function (it) { return '<li>' + escapeHtml(it) + '</li>'; }).join('') +
          '</ul></div>';
        break;
      case 'table':
        var rows = b.rows || [];
        inner = '<div class="blk table"><table>' +
          rows.map(function (row, ri) {
            var cellTag = ri === 0 ? 'th' : 'td';
            return '<tr>' + row.map(function (cell) {
              return '<' + cellTag + '>' + escapeHtml(cell) + '</' + cellTag + '>';
            }).join('') + '</tr>';
          }).join('') +
          '</table></div>';
        break;
      case 'photo':
        inner = '<div class="blk photo">' +
          '<div class="photo-badge">PHOTO</div>' +
          '<div>' + escapeHtml(b.caption || '（照片）') + '</div>' +
          '</div>';
        break;
      case 'sign':
        return '<div class="blk sign">' + escapeHtml(b.text || '') + '</div>';
      default:
        return '';
    }

    // 可摘录线索块（para / quote / photo）
    if (b.clue) {
      var clue = engine.getClue(b.clue);
      if (clue) {
        var extracted = clue.initial === true || engine.state.extracted.indexOf(b.clue) !== -1;

        // 关键词圈选模式：无金线无标记，玩家须逐一点出正文中的关键字眼（圈齐才收录）
        if (Array.isArray(b.keywords) && b.keywords.length && (b.type === 'para' || b.type === 'quote')) {
          var circledKws = (engine.state.circled && engine.state.circled[b.clue]) || [];
          // 已收录小印章（独立类 kw-stamp）：始终渲染（CSS 在未收录时隐藏），
          // 拼在正文容器 kw-wrap 内末尾（absolute 锚到 wrap——wrap 底即末行底，恒落行末），零重排
          var kwInner = '<div class="blk ' + b.type + ' kw-wrap">' +
            wrapKeywordText(b.text, b.keywords, b.clue, circledKws, extracted) +
            '<span class="kw-stamp">已收录</span></div>';
          return '<div class="blk clue-source kw-block' + (extracted ? ' extracted' : '') + '" data-clue="' + escapeHtml(b.clue) + '">' +
            kwInner +
          '</div>';
        }

        // 隐藏线索段：不带金线与摘录标签，玩家须通读正文才能发现（旧机制，向后兼容）
        if (b.hidden === true) {
          return '<div class="blk clue-source hidden-clue' + (extracted ? ' extracted' : '') + '" data-clue="' + escapeHtml(b.clue) + '">' +
            inner +
            '<span class="extract-tag">' + (extracted ? '已收录' : '') + '</span>' +
          '</div>';
        }

        var tagText = clue.initial === true ? '已在板上' : (extracted ? '已收录' : '摘录线索');
        return '<div class="blk clue-source' + (extracted ? ' extracted' : '') + '" data-clue="' + escapeHtml(b.clue) + '">' +
          inner +
          '<span class="extract-tag">' + tagText + '</span>' +
        '</div>';
      }
    }
    return inner;
  }

  /* ============ 顶栏 / 底栏统计 ============ */
  function setText(id, text) {
    var e = el(id);
    if (e) e.textContent = text;
  }
  function setDisabled(id, v) {
    var e = el(id);
    if (e) e.disabled = v;
  }

  function renderHUD(engine, currentDocId) {
    var c = engine.data.case;
    var firstMeta = engine.data.documents[0] && engine.data.documents[0].meta;
    setText('caseNo', '#' + ((firstMeta && firstMeta.no) ? firstMeta.no : 'CASE'));
    setText('caseName', c.title);
    setText('caseEpisode', (c.episode || '') + (c.subtitle ? ' · ' + c.subtitle : ''));
    setText('clueCount', engine.getBoardCards().length);
    setText('questionCount', engine.data.questions.filter(function (q) {
      return engine.isQuestionAvailable(q);
    }).length);
    setText('statMistakes', engine.state.mistakes);
    setText('statHints', engine.state.hintsUsed);

    var canAccuse = engine.canAccuse();
    setDisabled('btnAccuse', !canAccuse);
    setDisabled('btnAccuse2', !canAccuse);

    setText('docProgress', engine.state.readDocs.length + ' / ' + engine.data.documents.length + ' 份已阅');
  }

  /* ============ 线索板 ============ */
  function renderBoard(engine, activeQid, selectedCards) {
    var board = el('boardCards');
    var cards = engine.getBoardCards();

    if (!cards.length) {
      board.innerHTML = '<div class="board-empty">线索板还是空的<br>先去案宗里摘录线索吧</div>';
    } else {
      board.innerHTML = cards.map(function (card) {
        var selected = selectedCards.indexOf(card.id) !== -1;
        var cls = 'clue-card' + (selected ? ' selected' : '') + (card.kind === 'finding' ? ' deduction-card' : '');
        var cat = card.category || 'physical';
        return '<div class="' + cls + '" data-card-id="' + escapeHtml(card.id) + '">' +
          '<div class="cat-strip cat-' + cat + '"></div>' +
          '<div class="cc-cat-tag">' + (CAT_META[cat] || '') + '</div>' +
          '<div class="cc-label">' + escapeHtml(card.label) + '</div>' +
          '<div class="cc-text">' + escapeHtml(card.text) + '</div>' +
          (card.source ? '<div class="cc-src">出自 ' + escapeHtml(card.source) + '</div>' : '') +
        '</div>';
      }).join('');
    }

    // 议题列表
    var qlist = el('questionList');
    qlist.innerHTML = engine.data.questions.map(function (q) {
      var done = engine.state.solved.indexOf(q.id) !== -1;
      var available = engine.isQuestionAvailable(q);
      var active = q.id === activeQid;
      var cls = 'question-item' + (done ? ' done' : '') + (available ? ' ready' : '') +
        (active ? ' active' : '') + ((!done && !available) ? ' locked' : '');
      var stateHtml = '';
      var stateCls = '';
      var desc = shorten(q.prompt, 52);
      if (done) { stateCls = 'st-done'; stateHtml = '已解决'; }
      else if (available) { stateCls = 'st-ready'; stateHtml = '可推理'; }
      else {
        stateCls = 'st-locked';
        stateHtml = '依据不足 · 还缺 ' + engine.getQuestionMissing(q).total + ' 条材料';
        if (q.locked_hint) desc = q.locked_hint;
      }
      return '<div class="' + cls + '" data-qid="' + escapeHtml(q.id) + '">' +
        '<div class="qi-head"><span class="qi-title">' + escapeHtml(q.title) + '</span>' +
        '<span class="qi-stage">' + (q.stage || 1) + '</span></div>' +
        '<div class="qi-desc">' + escapeHtml(desc) + '</div>' +
        '<div class="qi-state ' + stateCls + '">' + stateHtml + '</div>' +
      '</div>';
    }).join('');

    var solvedCount = engine.state.solved.length;
    var totalQ = engine.data.questions.length;
    el('qpanelFoot').textContent = '进度 ' + solvedCount + ' / ' + totalQ +
      (engine.canAccuse() ? ' · 结案条件已达成，随时可以提交结案陈词' : ' · 完成主线议题后方可结案');
  }

  function shorten(str, n) {
    if (!str) return '';
    return str.length > n ? str.slice(0, n) + '……' : str;
  }

  /* ============ 推理栏 ============ */
  function renderDeduction(engine, question, selectedCards) {
    var idle = el('deductionIdle');
    var active = el('deductionActive');

    if (!question) {
      idle.classList.remove('hidden');
      active.classList.add('hidden');
      return;
    }
    idle.classList.add('hidden');
    active.classList.remove('hidden');

    el('dedPrompt').textContent = question.prompt;

    var slot = el('dedSlot');
    if (!selectedCards.length) {
      slot.innerHTML = '<span class="slot-empty">点击上方线索卡选择「推理材料」（可多选）</span>';
    } else {
      slot.innerHTML = selectedCards.map(function (id) {
        var card = engine.getBoardCards().filter(function (c) { return c.id === id; })[0];
        if (!card) return '';
        return '<span class="ded-chip">' + escapeHtml(card.label) +
          '<span class="chip-x" data-chip-id="' + escapeHtml(id) + '">×</span></span>';
      }).join('');
    }
  }

  /* ============ 结案模态 ============ */
  function renderAccuseModal(engine, selectedSuspect, selectedFindings) {
    var acc = engine.data.accusation;
    el('accusePrompt').textContent = acc.prompt;

    var suspectGrid = el('suspectGrid');
    suspectGrid.innerHTML = acc.suspects.map(function (cid) {
      var ch = engine.data.characters.filter(function (c) { return c.id === cid; })[0];
      if (!ch) return '';
      var sel = cid === selectedSuspect;
      return '<div class="suspect-card' + (sel ? ' selected' : '') + '" data-suspect-id="' + escapeHtml(cid) + '">' +
        '<div class="sc-name">' + escapeHtml(ch.name) + '</div>' +
        '<div class="sc-role">' + escapeHtml(ch.role) + '</div>' +
        (ch.desc ? '<div class="sc-desc">' + escapeHtml(ch.desc) + '</div>' : '') +
      '</div>';
    }).join('');

    var findings = engine.getFindings();
    var findGrid = el('findingGrid');
    if (!findings.length) {
      findGrid.innerHTML = '<div style="font-size:13px;color:#8a7350;">尚未获得任何结论卡 —— 先去解决推理议题。</div>';
    } else {
      findGrid.innerHTML = findings.map(function (f) {
        var sel = selectedFindings.indexOf(f.id) !== -1;
        return '<div class="finding-item' + (sel ? ' selected' : '') + '" data-finding-id="' + escapeHtml(f.id) + '">' +
          '<div class="fi-check">' + (sel ? '✓' : '') + '</div>' +
          '<div class="fi-main">' +
            '<div class="fi-label">' + escapeHtml(f.label) + '</div>' +
            '<div class="fi-text">' + escapeHtml(f.text) + '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    }
  }

  /* ============ 结算模态 ============ */
  function renderResultModal(engine) {
    el('resultRank').textContent = engine.getRank();
    el('resultStats').innerHTML =
      '<div><b>' + engine.getPlayMinutes() + '</b>用时（分钟）</div>' +
      '<div><b>' + engine.state.mistakes + '</b>失误</div>' +
      '<div><b>' + engine.state.hintsUsed + '</b>提示</div>';
  }

  /* ============ Toast ============ */
  var toastTimer = null;
  function toast(msg, type) {
    var t = el('toast');
    t.textContent = msg;
    t.className = 'toast' + (type ? ' toast-' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.className = 'toast hidden';
    }, 3800);
  }

  /* ============ 保存提示 ============ */
  function flashSaveFlag() {
    var f = el('saveFlag');
    if (!f) return;
    f.classList.add('show');
    clearTimeout(f._t);
    f._t = setTimeout(function () { f.classList.remove('show'); }, 1500);
  }

  /* ============ 白闪 ============ */
  function flashWhite() {
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:150;pointer-events:none;opacity:0;transition:opacity .1s;';
    document.body.appendChild(d);
    requestAnimationFrame(function () { d.style.opacity = '0.92'; });
    setTimeout(function () {
      d.style.opacity = '0';
      setTimeout(function () { d.remove(); }, 220);
    }, 120);
  }

  /* ============ 对话演出 ============ */
  function playScript(script, caseData) {
    return new Promise(function (resolve) {
      var layer = el('dialogLayer');
      var nameEl = el('dialogName');
      var textEl = el('dialogText');
      var nextEl = el('dialogNext');
      var flashEl = el('fxFlash');

      if (!script || !script.length) { resolve(); return; }

      layer.classList.remove('hidden');
      textEl.textContent = '';
      nameEl.textContent = '';
      nextEl.classList.remove('hidden');

      var idx = 0;
      var typing = false;
      var typeTimer = null;
      var currentFullText = '';
      var finished = false;

      function charName(id) {
        if (!id) return '旁白';
        var ch = (caseData.characters || []).filter(function (c) { return c.id === id; })[0];
        return ch ? ch.name : id;
      }

      function typeText(text) {
        currentFullText = text;
        typing = true;
        textEl.textContent = '';
        clearInterval(typeTimer);
        var i = 0;
        typeTimer = setInterval(function () {
          i += 1;
          textEl.textContent = currentFullText.slice(0, i);
          if (i >= currentFullText.length) {
            clearInterval(typeTimer);
            typing = false;
          }
        }, 22);
      }

      function showCurrent() {
        if (idx >= script.length) { done(); return; }
        var op = script[idx];
        if (op.op === 'say' || op.op === 'narrate') {
          var isNarr = op.op === 'narrate' || !op.who;
          nameEl.textContent = isNarr ? '旁白' : charName(op.who);
          nameEl.classList.toggle('narrator', !!isNarr);
          nextEl.classList.remove('hidden');
          typeText(op.text || '');
        } else if (op.op === 'fx') {
          if (op.type === 'flash_text' && op.text) {
            flashEl.innerHTML = '<span>' + escapeHtml(op.text) + '</span>';
            flashEl.classList.remove('hidden');
            // 守卫：若玩家点击已跳过本特效（或整段演出已结束），过期计时器不得再推进/隐藏图层
            var fxIdx = idx;
            setTimeout(function () {
              if (finished || idx !== fxIdx) return;
              flashEl.classList.add('hidden');
              flashEl.innerHTML = '';
              idx += 1;
              showCurrent();
            }, 1050);
          } else if (op.type === 'shake') {
            document.body.classList.add('shake-screen');
            setTimeout(function () { document.body.classList.remove('shake-screen'); }, 520);
            idx += 1; showCurrent();
          } else if (op.type === 'flash') {
            flashWhite();
            idx += 1; showCurrent();
          } else {
            idx += 1; showCurrent();
          }
        } else {
          // bgm / sfx 等 v2 静默跳过
          idx += 1; showCurrent();
        }
      }

      function advance() {
        if (finished) return;
        // 点击跳过：清除可能仍在展示的 flash_text 特效层（其自动推进计时器由守卫拦截）
        if (!flashEl.classList.contains('hidden')) {
          flashEl.classList.add('hidden');
          flashEl.innerHTML = '';
        }
        if (typing) {
          clearInterval(typeTimer);
          textEl.textContent = currentFullText;
          typing = false;
          return;
        }
        idx += 1;
        showCurrent();
      }

      function onLayerClick() { advance(); }
      function onKey(e) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          advance();
        }
      }

      function done() {
        finished = true;
        clearInterval(typeTimer);
        layer.removeEventListener('click', onLayerClick);
        document.removeEventListener('keydown', onKey);
        layer.classList.add('hidden');
        resolve();
      }

      layer.addEventListener('click', onLayerClick);
      document.addEventListener('keydown', onKey);
      showCurrent();
    });
  }

  global.NZCP_UI = {
    el: el,
    escapeHtml: escapeHtml,
    kwCircle: redCircleSvg,
    showScreen: showScreen,
    renderCaseList: renderCaseList,
    renderDocList: renderDocList,
    renderDoc: renderDoc,
    positionStamps: positionStamps,
    renderHUD: renderHUD,
    renderBoard: renderBoard,
    renderDeduction: renderDeduction,
    renderAccuseModal: renderAccuseModal,
    renderResultModal: renderResultModal,
    toast: toast,
    flashSaveFlag: flashSaveFlag,
    playScript: playScript
  };
})(typeof window !== 'undefined' ? window : this);
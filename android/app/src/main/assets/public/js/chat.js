var chatHistory = [];
var chatIsStreaming = false;

function initChat() {
  var container = document.getElementById('chat-messages');
  if (container && container.children.length === 0) {
    renderWelcome();
  }
  updateModelLabel();
}

function renderWelcome() {
  var container = document.getElementById('chat-messages');
  container.innerHTML = ''
    + '<div class="chat-welcome">'
    + '<div class="chat-welcome-icon">🧠</div>'
    + '<h2>DeepSeek 思考助手</h2>'
    + '<p class="chat-welcome-sub">基于 R1 模型 · 支持深度推理</p>'
    + '<div class="chat-suggestions">'
    + '<button onclick="sendSuggestion(\'用简单易懂的语言解释量子纠缠\')" class="chat-suggestion">🔬 解释量子纠缠</button>'
    + '<button onclick="sendSuggestion(\'用Python写一个快速排序算法\')" class="chat-suggestion">💻 写快速排序</button>'
    + '<button onclick="sendSuggestion(\'如何高效复习期末考试？\')" class="chat-suggestion">📚 复习方法</button>'
    + '</div>'
    + '</div>';
}

function sendSuggestion(text) {
  var input = document.getElementById('chat-input');
  input.value = text;
  sendMessage();
}

function sendMessage() {
  if (chatIsStreaming) return;
  var input = document.getElementById('chat-input');
  var text = input.value.trim();
  if (!text) return;

  if (CONST_DEEPSEEK_API_KEY === '请在这里填写你的APIKey' || CONST_DEEPSEEK_API_KEY === '') {
    showApiKeyPrompt();
    return;
  }

  // 清除欢迎页
  var container = document.getElementById('chat-messages');
  var welcome = container.querySelector('.chat-welcome');
  if (welcome) container.innerHTML = '';

  input.value = '';
  input.style.height = 'auto';
  updateSendBtn(false);

  // 渲染用户消息
  var userMsgId = 'usr-' + Date.now();
  container.insertAdjacentHTML('beforeend',
    '<div class="chat-msg chat-msg-user" id="' + userMsgId + '">'
    + '<div class="chat-bubble chat-bubble-user">' + escHtml(text) + '</div>'
    + '</div>'
  );
  scrollToBottom();

  streamResponse(text);
}

// 自动调整输入框高度
function onChatInput(e) {
  var input = e.target;
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  updateSendBtn(input.value.trim().length > 0);
}

function onChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function updateSendBtn(hasText) {
  var btn = document.getElementById('chat-send-btn');
  if (!btn) return;
  btn.disabled = !hasText || chatIsStreaming;
  btn.style.opacity = hasText && !chatIsStreaming ? '1' : '0.4';
}

async function streamResponse(userText) {
  chatIsStreaming = true;
  updateSendBtn(false);

  chatHistory.push({ role: 'user', content: userText });

  var aiMsgId = 'ai-' + Date.now();
  var container = document.getElementById('chat-messages');

  // 创建 AI 消息占位
  container.insertAdjacentHTML('beforeend',
    '<div class="chat-msg chat-msg-ai" id="' + aiMsgId + '">'
    + '<div class="chat-ai-avatar">🧠</div>'
    + '<div class="chat-ai-body">'
    + '<div class="reasoning-block" id="reasoning-' + aiMsgId + '" style="display:none">'
    + '<div class="reasoning-header" onclick="toggleReasoning(\'' + aiMsgId + '\')">'
    + '<span class="reasoning-icon">💭</span>'
    + '<span class="reasoning-label">思考中...</span>'
    + '<span class="reasoning-toggle" id="reasoning-toggle-' + aiMsgId + '">▾</span>'
    + '</div>'
    + '<div class="reasoning-content" id="reasoning-content-' + aiMsgId + '"></div>'
    + '</div>'
    + '<div class="chat-bubble chat-bubble-ai" id="content-' + aiMsgId + '"></div>'
    + '</div>'
    + '</div>'
  );
  scrollToBottom();

  var reasoningBlock = document.getElementById('reasoning-' + aiMsgId);
  var reasoningContent = document.getElementById('reasoning-content-' + aiMsgId);
  var reasoningLabel = reasoningBlock.querySelector('.reasoning-label');
  var contentBubble = document.getElementById('content-' + aiMsgId);
  var reasoningText = '';
  var answerText = '';
  var hasReasoning = false;

  try {
    var response = await fetch(CONST_DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CONST_DEEPSEEK_API_KEY
      },
      body: JSON.stringify({
        model: CONST_DEEPSEEK_MODEL,
        messages: chatHistory,
        stream: true
      })
    });

    if (!response.ok) {
      var errText = '';
      try { var errJson = JSON.parse(await response.text()); errText = errJson.error && errJson.error.message ? errJson.error.message : ''; } catch (e) {}
      throw new Error('API 请求失败 (' + response.status + ') ' + errText);
    }

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    while (true) {
      var result = await reader.read();
      if (result.done) break;

      buffer += decoder.decode(result.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || !line.startsWith('data: ')) continue;
        var data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          var json = JSON.parse(data);
          var delta = json.choices && json.choices[0] && json.choices[0].delta;
          if (!delta) continue;

          if (delta.reasoning_content) {
            hasReasoning = true;
            reasoningBlock.style.display = 'block';
            reasoningText += delta.reasoning_content;
            reasoningContent.innerHTML = renderMarkdown(reasoningText);
          }

          if (delta.content) {
            answerText += delta.content;
            contentBubble.innerHTML = renderMarkdown(answerText);
          }
        } catch (e) {}
      }
      scrollToBottom();
    }

    // 推理完成
    if (hasReasoning) {
      reasoningLabel.textContent = '已思考';
      reasoningBlock.classList.add('reasoning-done');
    }

    // 保存到历史
    chatHistory.push({
      role: 'assistant',
      content: answerText,
      reasoning_content: hasReasoning ? reasoningText : undefined
    });

  } catch (e) {
    contentBubble.innerHTML = '<span class="chat-error">❌ ' + escHtml(e.message || '请求失败，请检查网络和API Key') + '</span>';
    if (reasoningBlock.style.display === 'block') {
      reasoningBlock.style.display = 'none';
    }
    console.error('DeepSeek API error:', e);
  }

  chatIsStreaming = false;
  updateSendBtn(true);
}

function toggleReasoning(msgId) {
  var content = document.getElementById('reasoning-content-' + msgId);
  var toggle = document.getElementById('reasoning-toggle-' + msgId);
  var block = document.getElementById('reasoning-' + msgId);
  if (!content || !toggle) return;

  if (content.style.display === 'none') {
    content.style.display = 'block';
    toggle.textContent = '▾';
    block.classList.add('reasoning-open');
  } else {
    content.style.display = 'none';
    toggle.textContent = '▸';
    block.classList.remove('reasoning-open');
  }
  scrollToBottom();
}

function clearChat() {
  chatHistory = [];
  var container = document.getElementById('chat-messages');
  container.innerHTML = '';
  renderWelcome();
}

function toggleModel() {
  if (chatIsStreaming) return;
  if (CONST_DEEPSEEK_MODEL === 'deepseek-reasoner') {
    CONST_DEEPSEEK_MODEL = 'deepseek-chat';
  } else {
    CONST_DEEPSEEK_MODEL = 'deepseek-reasoner';
  }

  if (chatHistory.length > 0) {
    if (confirm('切换模型将清空当前对话，确定继续？')) {
      clearChat();
    } else {
      // 还原
      CONST_DEEPSEEK_MODEL = CONST_DEEPSEEK_MODEL === 'deepseek-reasoner' ? 'deepseek-chat' : 'deepseek-reasoner';
      return;
    }
  }
  updateModelLabel();
}

function updateModelLabel() {
  var label = document.getElementById('chat-model-label');
  if (!label) return;
  var names = { 'deepseek-reasoner': 'DeepSeek-R1 · 深度推理', 'deepseek-chat': 'DeepSeek-V3 · 通用对话' };
  label.textContent = names[CONST_DEEPSEEK_MODEL] || CONST_DEEPSEEK_MODEL;
}

function showApiKeyPrompt() {
  var key = prompt('请先填写你的 DeepSeek API Key：\n\n（获取地址：https://platform.deepseek.com/api_keys）', '');
  if (key && key.trim()) {
    CONST_DEEPSEEK_API_KEY = key.trim();
  }
}

function scrollToBottom() {
  var container = document.getElementById('chat-messages');
  if (container) {
    setTimeout(function () {
      container.scrollTop = container.scrollHeight;
    }, 10);
  }
}

// ── 简易 Markdown 渲染 ──────────────────────

function renderMarkdown(text) {
  if (!text) return '';

  // 保护代码块
  var codeBlocks = [];
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, code) {
    var idx = codeBlocks.length;
    codeBlocks.push({ lang: lang || '', code: escHtml(code.trim()) });
    return '\x00CODE' + idx + '\x00';
  });

  // 保护行内代码
  var inlineCodes = [];
  text = text.replace(/`([^`]+)`/g, function (_, code) {
    var idx = inlineCodes.length;
    inlineCodes.push(escHtml(code));
    return '\x00ICODE' + idx + '\x00';
  });

  // 转义 HTML（除了已保护的部分）
  text = escHtml(text);

  // 粗体
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // 斜体
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // 链接
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  // 标题
  text = text.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  text = text.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  text = text.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // 分割线
  text = text.replace(/^---+$/gm, '<hr>');
  // 无序列表
  text = text.replace(/^[\-*] (.+)$/gm, '<li>$1</li>');

  // 换行处理
  var paragraphs = text.split('\n\n');
  text = paragraphs.map(function (p) {
    p = p.trim();
    if (!p) return '';
    if (/^<(h[1-4]|li|hr|pre|ul|ol)/.test(p)) return p;
    // 包裹连续的 <li>
    if (/<li>/.test(p) && !/<ul>/.test(p)) return '<ul>' + p + '</ul>';
    return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
  }).join('');

  // 恢复行内代码
  text = text.replace(/\x00ICODE(\d+)\x00/g, function (_, idx) {
    return '<code class="inline-code">' + inlineCodes[parseInt(idx)] + '</code>';
  });

  // 恢复代码块
  text = text.replace(/\x00CODE(\d+)\x00/g, function (_, idx) {
    var block = codeBlocks[parseInt(idx)];
    var langLabel = block.lang ? '<div class="code-lang">' + escHtml(block.lang) + '</div>' : '';
    return '<pre class="code-block">' + langLabel + '<code>' + block.code + '</code></pre>';
  });

  return text;
}

// ── 工具函数 ────────────────────────────────

function escHtml(str) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

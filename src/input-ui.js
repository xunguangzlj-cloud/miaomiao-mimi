(function () {
  'use strict';

  function createInputUI(options) {
    options = options || {};
    const wechat = options.wx || (typeof wx !== 'undefined' ? wx : null);
    const browser = options.window || (typeof window !== 'undefined' ? window : null);
    const document = browser && browser.document;
    let active = null, destroyed = false;

    function editNickname(current, done) {
      if (active) active.finish(false);
      const initial = typeof current === 'string' ? current : '';
      const callback = typeof done === 'function' ? done : function () {};
      if (destroyed) { callback({ confirmed: false, value: initial }); return; }
      const request = { finished: false, cleanup: function () {} };
      active = request;
      request.finish = function (confirmed, value) {
        if (request.finished) return;
        request.finished = true;
        if (active === request) active = null;
        request.cleanup();
        callback({ confirmed: !!confirmed, value: confirmed && typeof value === 'string' ? value : initial });
      };

      if (wechat && typeof wechat.showKeyboard === 'function') {
        // 完整的监听清理 API 是此编辑器的前提，避免旧键盘事件保存另一次输入。
        const methods = ['onKeyboardConfirm', 'offKeyboardConfirm', 'onKeyboardComplete', 'offKeyboardComplete'];
        if (methods.some(name => typeof wechat[name] !== 'function')) { request.finish(false); return; }
        const confirm = event => request.finish(true, event && event.value);
        const complete = () => request.finish(false);
        let confirmAttached = false, completeAttached = false;
        request.cleanup = function () {
          if (confirmAttached) {
            try { wechat.offKeyboardConfirm(confirm); } catch (_) { /* 旧事件也受一次性完成状态保护。 */ }
            confirmAttached = false;
          }
          if (completeAttached) {
            try { wechat.offKeyboardComplete(complete); } catch (_) { /* 继续清理另一监听和键盘。 */ }
            completeAttached = false;
          }
          if (typeof wechat.hideKeyboard === 'function') {
            try { wechat.hideKeyboard({}); } catch (_) { /* 失败或已经收起时无需再次处理。 */ }
          }
        };
        try {
          wechat.onKeyboardConfirm(confirm); confirmAttached = true;
          wechat.onKeyboardComplete(complete); completeAttached = true;
          wechat.showKeyboard({ defaultValue: initial, maxLength: 12, multiple: false,
            confirmHold: false, confirmType: 'done', fail: () => request.finish(false) });
        } catch (_) { request.finish(false); }
        return;
      }

      if (!document || !document.body || typeof document.createElement !== 'function') {
        request.finish(false); return;
      }
      const previousFocus = document.activeElement;
      const element = (tag, text, css) => {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (css) node.style.cssText = css;
        return node;
      };
      const overlay = element('div', undefined, 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#211a18b8;padding:20px;padding-top:max(20px,env(safe-area-inset-top));padding-bottom:max(20px,env(safe-area-inset-bottom));box-sizing:border-box;');
      const panel = element('div', undefined, 'width:min(100%,360px);max-height:100%;overflow:auto;border-radius:26px;background:#fffaf4;padding:26px 22px 22px;box-sizing:border-box;box-shadow:0 16px 48px #24131044;font-family:system-ui,"Microsoft YaHei",sans-serif;color:#935a5a;');
      panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-labelledby', 'meow-nickname-title');
      const title = element('h2', '修改昵称', 'font-size:25px;font-weight:500;margin:0 0 22px;text-align:center;');
      title.id = 'meow-nickname-title';
      const input = element('input', undefined, 'width:100%;height:54px;box-sizing:border-box;padding:12px 14px;border:1px solid #ddc9b9;border-radius:14px;background:#f9ede0;color:#935a5a;font:20px system-ui,"Microsoft YaHei",sans-serif;outline-color:#f7931b;');
      // 原生长度按 UTF-16 计算，留出十二个表情符号的空间，提交时再按码点验证。
      input.type = 'text'; input.maxLength = 24; input.value = initial; input.autocomplete = 'off';
      input.spellcheck = false; input.setAttribute('aria-label', '昵称，输入一至十二个字符');
      const detail = element('p', '请输入 1～12 个字符的昵称', 'font-size:13px;color:#af9081;margin:10px 0 24px;');
      detail.setAttribute('aria-live', 'polite');
      const buttons = element('div', undefined, 'display:flex;gap:12px;');
      const cancel = element('button', '取消', 'flex:1;height:48px;border:1px solid #c99160;border-radius:24px;background:#fffaf4;color:#a8704b;font:18px system-ui,"Microsoft YaHei",sans-serif;cursor:pointer;');
      const confirm = element('button', '确定', 'flex:1;height:48px;border:0;border-radius:24px;background:#f7931b;color:white;font:18px system-ui,"Microsoft YaHei",sans-serif;box-shadow:0 5px 12px #f7931b33;cursor:pointer;');
      cancel.type = confirm.type = 'button';
      buttons.appendChild(cancel); buttons.appendChild(confirm);
      panel.appendChild(title); panel.appendChild(input); panel.appendChild(detail); panel.appendChild(buttons);
      overlay.appendChild(panel);
      const submit = () => {
        const value = input.value.trim().replace(/\s+/g, ' ');
        if (!value || Array.from(value).length > 12 || /[\u0000-\u001F\u007F]/.test(input.value)) {
          detail.textContent = '请输入 1～12 个字符的昵称'; detail.style.color = '#B8634E';
          input.setAttribute('aria-invalid', 'true'); input.focus(); return;
        }
        request.finish(true, value);
      };
      const keydown = event => {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') { event.preventDefault(); request.finish(false); }
        else if (event.key === 'Enter') {
          event.preventDefault(); if (event.target === cancel) request.finish(false); else submit();
        } else if (event.key === 'Tab') {
          const controls = [input, cancel, confirm];
          const index = controls.indexOf(document.activeElement);
          const next = index < 0 ? (event.shiftKey ? controls.length - 1 : 0)
            : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
          event.preventDefault(); controls[next].focus();
        }
      };
      const visibility = () => { if (document.hidden) request.finish(false); };
      const viewport = browser.visualViewport;
      const fitKeyboard = () => {
        if (!viewport || !(viewport.height > 0)) return;
        overlay.style.top = (viewport.offsetTop || 0) + 'px';
        overlay.style.bottom = 'auto';
        overlay.style.height = viewport.height + 'px';
      };
      cancel.addEventListener('click', () => request.finish(false));
      confirm.addEventListener('click', submit);
      overlay.addEventListener('pointerdown', event => { if (event.target === overlay) request.finish(false); });
      request.cleanup = function () {
        document.removeEventListener('keydown', keydown);
        document.removeEventListener('visibilitychange', visibility);
        if (viewport && typeof viewport.removeEventListener === 'function') {
          viewport.removeEventListener('resize', fitKeyboard);
          viewport.removeEventListener('scroll', fitKeyboard);
        }
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (previousFocus && typeof previousFocus.focus === 'function' && !document.hidden) {
          try { previousFocus.focus(); } catch (_) { /* 原元素可能已随页面关闭。 */ }
        }
      };
      document.addEventListener('keydown', keydown);
      document.addEventListener('visibilitychange', visibility);
      if (viewport && typeof viewport.addEventListener === 'function') {
        viewport.addEventListener('resize', fitKeyboard);
        viewport.addEventListener('scroll', fitKeyboard);
      }
      document.body.appendChild(overlay);
      fitKeyboard();
      input.focus();
      if (typeof input.select === 'function') input.select();
    }

    function destroy() {
      destroyed = true;
      if (active) active.finish(false);
    }

    return { editNickname, destroy };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createInputUI };
  else if (typeof window !== 'undefined') window.MeowInputUI = { createInputUI };
})();

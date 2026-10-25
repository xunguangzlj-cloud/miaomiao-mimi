'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createInputUI } = require('../src/input-ui');

function wechatMock(options) {
  options = options || {};
  const listeners = { confirm: new Set(), complete: new Set() }, calls = { show: [], hide: 0, off: [] };
  const wx = {
    onKeyboardConfirm(fn) { listeners.confirm.add(fn); },
    offKeyboardConfirm(fn) { calls.off.push('confirm'); listeners.confirm.delete(fn); },
    onKeyboardComplete(fn) { listeners.complete.add(fn); },
    offKeyboardComplete(fn) { calls.off.push('complete'); listeners.complete.delete(fn); },
    showKeyboard(value) { calls.show.push(value); if (options.fail) value.fail(); },
    hideKeyboard() { calls.hide++; for (const fn of listeners.complete) fn({ value: '收起不应保存' }); }
  };
  return { wx, calls, listeners, emit(name, value) { for (const fn of [...listeners[name]]) fn(value); } };
}

function browserMock() {
  const listeners = new Map(), viewportListeners = new Map();
  const document = { hidden: false,
    createElement(tag) {
      return { tag, style: {}, children: [], attributes: {}, listeners: new Map(),
        setAttribute(name, value) { this.attributes[name] = value; },
        appendChild(node) { this.children.push(node); node.parentNode = this; },
        removeChild(node) { this.children.splice(this.children.indexOf(node), 1); node.parentNode = null; },
        addEventListener(name, fn) { this.listeners.set(name, fn); },
        emit(name, event) { const fn = this.listeners.get(name); if (fn) fn(event || { target: this }); },
        focus() { document.activeElement = this; }, select() { this.selected = true; }
      };
    },
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { if (listeners.has(name)) listeners.get(name).delete(fn); },
    emit(name, event) { for (const fn of [...(listeners.get(name) || [])]) fn(event); }
  };
  document.body = document.createElement('body');
  const canvas = document.createElement('canvas'); document.body.appendChild(canvas); canvas.focus();
  const viewport = { height: 400, offsetTop: 20,
    addEventListener(name, fn) { if (!viewportListeners.has(name)) viewportListeners.set(name, new Set()); viewportListeners.get(name).add(fn); },
    removeEventListener(name, fn) { if (viewportListeners.has(name)) viewportListeners.get(name).delete(fn); },
    emit(name) { for (const fn of [...(viewportListeners.get(name) || [])]) fn(); }
  };
  return { window: { document, visualViewport: viewport }, document, canvas, listeners, viewport, viewportListeners,
    dialog() {
      const overlay = document.body.children[1], panel = overlay.children[0], buttons = panel.children[3];
      return { overlay, panel, input: panel.children[1], cancel: buttons.children[0], confirm: buttons.children[1] };
    }
  };
}

function key(key, target, extra) {
  return Object.assign({ key, target, prevented: false, preventDefault() { this.prevented = true; } }, extra);
}

test('微信键盘按规定传参，确认一次保存且先解绑再收起', () => {
  const m = wechatMock(), ui = createInputUI({ wx: m.wx }), answers = [];
  ui.editNickname('小猫', value => answers.push(value));
  const setup = m.calls.show[0];
  assert.equal(setup.defaultValue, '小猫'); assert.equal(setup.maxLength, 12); assert.equal(setup.multiple, false);
  assert.equal(setup.confirmHold, false); assert.equal(setup.confirmType, 'done');
  const lateConfirm = [...m.listeners.confirm][0], lateComplete = [...m.listeners.complete][0];
  m.emit('confirm', { value: '新昵称' }); lateComplete({ value: '其它' }); lateConfirm({ value: '迟到' });
  assert.deepEqual(answers, [{ confirmed: true, value: '新昵称' }]);
  assert.deepEqual(m.calls.off, ['confirm', 'complete']); assert.equal(m.calls.hide, 1);
  assert.equal(m.listeners.confirm.size, 0); assert.equal(m.listeners.complete.size, 0);
});

test('微信键盘直接收起属于取消，未确认的输入不保存', () => {
  const m = wechatMock(), ui = createInputUI({ wx: m.wx }), answers = [];
  ui.editNickname('原昵称', value => answers.push(value));
  m.emit('complete', { value: '输入后收起' });
  assert.deepEqual(answers, [{ confirmed: false, value: '原昵称' }]); assert.equal(m.calls.hide, 1);
});

test('微信键盘打开失败也清理两个监听，回调只返回一次取消', () => {
  const m = wechatMock({ fail: true }), ui = createInputUI({ wx: m.wx }), answers = [];
  ui.editNickname('原昵称', value => answers.push(value));
  assert.deepEqual(answers, [{ confirmed: false, value: '原昵称' }]);
  assert.equal(m.listeners.confirm.size + m.listeners.complete.size, 0); assert.equal(m.calls.hide, 1);
});

test('微信重复打开先取消上一次，销毁取消当前并拒绝后续编辑', () => {
  const m = wechatMock(), ui = createInputUI({ wx: m.wx }), answers = [];
  ui.editNickname('第一', value => answers.push(value)); ui.editNickname('第二', value => answers.push(value));
  assert.deepEqual(answers, [{ confirmed: false, value: '第一' }]); assert.equal(m.listeners.confirm.size, 1);
  ui.destroy(); ui.destroy(); ui.editNickname('第三', value => answers.push(value));
  assert.deepEqual(answers, ['第一', '第二', '第三'].map(value => ({ confirmed: false, value })));
  assert.equal(m.listeners.confirm.size + m.listeners.complete.size, 0); assert.equal(m.calls.show.length, 2);
});

test('微信监听 API 不完整时不留下无法解绑的全局监听', () => {
  const m = wechatMock(), answers = [];
  delete m.wx.offKeyboardConfirm;
  createInputUI({ wx: m.wx }).editNickname('昵称', value => answers.push(value));
  assert.deepEqual(answers, [{ confirmed: false, value: '昵称' }]); assert.equal(m.calls.show.length, 0);
  assert.equal(m.listeners.confirm.size + m.listeners.complete.size, 0);
});

test('网页显示中文原生输入模态，保留画布并支持确定保存', () => {
  const m = browserMock(), ui = createInputUI({ window: m.window }), answers = [];
  ui.editNickname('小猫', value => answers.push(value)); const d = m.dialog();
  assert.equal(d.panel.attributes.role, 'dialog'); assert.equal(d.panel.attributes['aria-modal'], 'true');
  assert.equal(d.panel.children[0].textContent, '修改昵称'); assert.equal(d.input.type, 'text');
  assert.equal(d.input.maxLength, 24); assert.equal(d.input.value, '小猫'); assert.equal(d.input.selected, true);
  assert.equal(d.panel.children[2].textContent, '请输入 1～12 个字符的昵称');
  assert.equal(d.cancel.textContent, '取消'); assert.equal(d.confirm.textContent, '确定');
  assert.match(d.overlay.style.cssText, /safe-area-inset/); assert.equal(m.document.body.children[0], m.canvas);
  d.input.value = '胖胖'; d.confirm.emit('click'); d.confirm.emit('click');
  assert.deepEqual(answers, [{ confirmed: true, value: '胖胖' }]); assert.deepEqual(m.document.body.children, [m.canvas]);
  assert.equal(m.document.activeElement, m.canvas); assert.equal(m.listeners.get('keydown').size, 0);
});

test('网页 Enter 确认，中文输入法组字中的 Enter 不会误保存', () => {
  const m = browserMock(), ui = createInputUI({ window: m.window }), answers = [];
  ui.editNickname('旧昵称', value => answers.push(value)); const d = m.dialog(); d.input.value = '中文';
  m.document.emit('keydown', key('Enter', d.input, { isComposing: true })); assert.equal(answers.length, 0);
  m.document.emit('keydown', key('Enter', d.input, { keyCode: 229 })); assert.equal(answers.length, 0);
  const event = key('Enter', d.input); m.document.emit('keydown', event);
  assert.equal(event.prevented, true); assert.deepEqual(answers, [{ confirmed: true, value: '中文' }]);
});

test('网页按码点允许十二个表情，十三个表情原位提示并保留输入', () => {
  const m = browserMock(), ui = createInputUI({ window: m.window }), answers = [];
  ui.editNickname('旧昵称', value => answers.push(value)); const d = m.dialog();
  const thirteen = '🐱'.repeat(13); d.input.value = thirteen; d.confirm.emit('click');
  assert.equal(answers.length, 0); assert.equal(d.input.value, thirteen); assert.equal(m.document.body.children.length, 2);
  assert.equal(d.input.attributes['aria-invalid'], 'true'); assert.equal(d.panel.children[2].textContent, '请输入 1～12 个字符的昵称');
  const twelve = '🐱'.repeat(12); d.input.value = twelve;
  m.document.emit('keydown', key('Enter', d.input));
  assert.deepEqual(answers, [{ confirmed: true, value: twelve }]); assert.equal(m.document.body.children.length, 1);
});

test('网页空白和超过十二个普通字符不会关闭，修正后可以保存', () => {
  const m = browserMock(), ui = createInputUI({ window: m.window }), answers = [];
  ui.editNickname('旧昵称', value => answers.push(value)); const d = m.dialog();
  for (const value of ['   ', '一'.repeat(13), '昵称\u0000']) {
    d.input.value = value; d.confirm.emit('click'); assert.equal(answers.length, 0);
    assert.equal(d.input.value, value); assert.equal(m.document.body.children.length, 2);
  }
  d.input.value = '  开心小猫  '; d.confirm.emit('click');
  assert.deepEqual(answers, [{ confirmed: true, value: '开心小猫' }]);
});

test('网页 Escape、取消按钮和遮罩外点均取消未保存输入', () => {
  for (const action of ['escape', 'button', 'outside']) {
    const m = browserMock(), ui = createInputUI({ window: m.window }), answers = [];
    ui.editNickname('原昵称', value => answers.push(value)); const d = m.dialog(); d.input.value = '未确认';
    if (action === 'escape') m.document.emit('keydown', key('Escape', d.input));
    if (action === 'button') d.cancel.emit('click');
    if (action === 'outside') d.overlay.emit('pointerdown', { target: d.overlay });
    assert.deepEqual(answers, [{ confirmed: false, value: '原昵称' }]); assert.equal(m.document.body.children.length, 1);
  }
});

test('网页焦点循环留在输入和按钮，取消按钮 Enter 不保存', () => {
  const m = browserMock(), answers = [], ui = createInputUI({ window: m.window });
  ui.editNickname('昵称', value => answers.push(value)); const d = m.dialog();
  m.document.emit('keydown', key('Tab', d.input, { shiftKey: true })); assert.equal(m.document.activeElement, d.confirm);
  m.document.emit('keydown', key('Tab', d.confirm)); assert.equal(m.document.activeElement, d.input);
  m.document.emit('keydown', key('Tab', d.input)); assert.equal(m.document.activeElement, d.cancel);
  m.document.emit('keydown', key('Enter', d.cancel)); assert.deepEqual(answers, [{ confirmed: false, value: '昵称' }]);
});

test('网页适应手机键盘视口，退出清理视口监听', () => {
  const m = browserMock(), ui = createInputUI({ window: m.window });
  ui.editNickname('昵称', () => {}); const d = m.dialog();
  assert.equal(d.overlay.style.height, '400px'); assert.equal(d.overlay.style.top, '20px');
  m.viewport.height = 240; m.viewport.offsetTop = 0; m.viewport.emit('resize');
  assert.equal(d.overlay.style.height, '240px'); assert.equal(d.overlay.style.top, '0px');
  ui.destroy(); assert.equal(m.viewportListeners.get('resize').size, 0); assert.equal(m.viewportListeners.get('scroll').size, 0);
});

test('网页进入后台或销毁取消编辑，重复事件无副作用', () => {
  const m = browserMock(), answers = [], ui = createInputUI({ window: m.window });
  ui.editNickname('昵称', value => answers.push(value)); const d = m.dialog();
  m.document.hidden = true; m.document.emit('visibilitychange'); d.confirm.emit('click'); ui.destroy();
  assert.deepEqual(answers, [{ confirmed: false, value: '昵称' }]);
  assert.equal(m.listeners.get('visibilitychange').size, 0); assert.equal(m.document.body.children.length, 1);
});

test('没有键盘或 DOM 环境时明确取消，而不是假称保存', () => {
  const answers = [];
  createInputUI({ wx: {}, window: {} }).editNickname('原昵称', value => answers.push(value));
  assert.deepEqual(answers, [{ confirmed: false, value: '原昵称' }]);
});

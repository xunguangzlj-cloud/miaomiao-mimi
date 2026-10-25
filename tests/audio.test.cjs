'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAudio } = require('../src/audio');

function mockWechat(lazy) {
  const nodes = [], requests = [];
  const wx = { createInnerAudioContext() {
    const node = { plays: 0, stops: 0, pauses: 0, destroys: 0,
      play() { this.plays++; if (this.nextPlay) return this.nextPlay(); },
      stop() { this.stops++; }, pause() { this.pauses++; },
      destroy() { this.destroys++; }, onError(fn) { this.error = fn; }, onEnded(fn) { this.ended = fn; }
    };
    nodes.push(node); return node;
  }, loadSubpackage(request) { requests.push(request); if (!lazy) request.success(); } };
  return { wx, nodes, requests };
}

function mockBrowser(reject) {
  const nodes = [];
  class Audio {
    constructor() { nodes.push(this); this.plays = 0; this.pauses = 0; this.currentTime = 12; this.events = {}; }
    play() { this.plays++; return this.nextPlay ? this.nextPlay() : reject ? Promise.reject(new Error('需用户触摸')) : Promise.resolve(); }
    pause() { this.pauses++; }
    load() { this.loaded = true; }
    addEventListener(name, fn) { this.events[name] = fn; }
  }
  return { window: { Audio }, nodes };
}

function forFile(mock, file) { return mock.nodes.filter(node => node.src.endsWith('/' + file + '.mp3')); }

test('首次操作前不自动播放，也不积压后台事件', () => {
  const m = mockWechat(), audio = createAudio({ wx: m.wx, settings: { music: true } });
  audio.configure({ music: true }); audio.resume(); audio.event('win');
  assert.equal(m.nodes.length, 0); assert.equal(m.requests.length, 0);
  audio.unlock(); assert.equal(m.nodes.length, 1); assert.equal(m.nodes[0].plays, 1);
  assert.equal(m.nodes[0].src, 'audio-assets/bgm_rain_piano.mp3'); assert.equal(m.nodes[0].loop, true);
  assert.equal(m.nodes[0].volume, 1); assert.equal(m.requests[0].name, 'audio');
});

test('音乐与音效开关互相独立，关闭立即停止对应声道', () => {
  const m = mockWechat(), audio = createAudio({ wx: m.wx, settings: { music: true } });
  audio.unlock(); audio.event('correct');
  assert.equal(m.nodes.length, 2);
  const music = m.nodes[0], sound = m.nodes[1];
  assert.deepEqual(audio.getState().playing, ['music', 'sound']);
  audio.configure({ sound: false });
  assert.ok(sound.stops > 0); assert.deepEqual(audio.getState().playing, ['music']);
  audio.configure({ music: false }); assert.ok(music.stops > 0); assert.deepEqual(audio.getState().playing, []);
  const playCount = sound.plays; audio.event('error'); assert.equal(sound.plays, playCount);
});

test('只开启音乐时操作不会创建额外声道，关闭音乐后操作音效仍可启用', () => {
  const m = mockWechat(), audio = createAudio({ wx: m.wx, settings: { music: true, sound: false } });
  audio.unlock(); audio.event('checkin'); audio.event('board');
  assert.equal(m.nodes.length, 1); assert.match(m.nodes[0].src, /bgm_rain_piano.mp3/);
  assert.equal(m.nodes[0].plays, 1);
  audio.configure({ music: false, sound: true }); audio.event('win');
  assert.deepEqual(audio.getState().playing, ['sound']); assert.equal(m.nodes.length, 2);
  assert.match(m.nodes[1].src, /level_win.mp3/);
});

test('连续操作遵守并发上限，复用最早声道且自然结束后优先复用空闲声道', () => {
  const limits = { correct: 3, error: 2, click: 4, mark: 4, unmark: 4, hint: 1, board: 1, win: 1, fail: 1, dialog: 1, clear: 1 };
  for (const [name, limit] of Object.entries(limits)) {
    const m = mockWechat(), audio = createAudio({ wx: m.wx }); audio.unlock();
    for (let index = 0; index < limit; index++) assert.equal(audio.event(name), true);
    assert.equal(m.nodes.length, limit, name);
    audio.event(name); assert.equal(m.nodes.length, limit, name); assert.equal(m.nodes[0].plays, 2, name);
    m.nodes[limit - 1].ended(); audio.event(name);
    assert.equal(m.nodes.length, limit, name); assert.equal(m.nodes[limit - 1].plays, limit === 1 ? 3 : 2, name);
    assert.equal(m.nodes.reduce((count, node) => count + node.plays, 0), limit + 2, name);
  }
});

test('后台暂停音乐并截断所有短声，回到前台只恢复音乐', () => {
  const m = mockWechat(), audio = createAudio({ wx: m.wx, settings: { music: true } });
  audio.unlock(); audio.event('helper'); audio.event('mark'); audio.pause();
  assert.equal(m.nodes[0].pauses, 1); m.nodes.slice(1).forEach(node => assert.ok(node.stops));
  assert.deepEqual(audio.getState().playing, []);
  audio.event('correct'); assert.equal(m.nodes[1].plays, 1);
  m.nodes.slice(1).forEach(node => node.ended()); assert.equal(m.nodes[0].plays, 1);
  audio.resume(); assert.equal(m.nodes[0].plays, 2); assert.equal(m.nodes[1].plays, 1);
});

test('隐藏期间修改开关不会开始声音，恢复后遵守最新设置', () => {
  const m = mockWechat(), audio = createAudio({ wx: m.wx });
  audio.unlock(); audio.pause(); audio.configure({ music: true });
  assert.equal(m.nodes.length, 0); assert.equal(m.requests.length, 0);
  audio.resume(); assert.equal(m.nodes[0].plays, 1);
  audio.pause(); audio.configure({ music: false }); audio.resume(); assert.equal(m.nodes[0].plays, 1);
});

test('事件使用对应素材和原音量，辅助放置及打卡复用对应音频音且没有人声事件', () => {
  const mapping = { correct: 'mark_cat', helper: 'mark_cat', error: 'mark_wrong_1', hint: 'use_hint', checkin: 'use_hint',
    win: 'level_win', click: 'btn_click_2', board: 'board_enter_1', mark: 'mark_x_2', unmark: 'unmark_x_2',
    fail: 'level_fail', dialog: 'dlg_open_1', clear: 'all_cleared' };
  const m = mockWechat(), audio = createAudio({ wx: m.wx }); audio.unlock();
  for (const [event, file] of Object.entries(mapping)) {
    const previous = m.nodes.reduce((count, node) => count + node.plays, 0);
    assert.equal(audio.event(event), true); assert.ok(forFile(m, file).some(node => node.plays > 0));
    assert.equal(m.nodes.reduce((count, node) => count + node.plays, 0), previous + 1);
  }
  assert.equal(forFile(m, 'mark_cat').length, 2); assert.equal(forFile(m, 'use_hint').length, 1);
  for (const node of m.nodes) { assert.equal(node.volume, 1); assert.equal(node.obeyMuteSwitch, true); assert.equal(node.loop, false); }
  for (const name of ['不存在', 'voice', 'combo', 'meow', 'autoMark']) assert.equal(audio.event(name), false);
});

test('销毁释放所有微信声道，重复销毁和旧回调不会继续播放', () => {
  const m = mockWechat(), audio = createAudio({ wx: m.wx, settings: { music: true } });
  audio.unlock(); audio.event('mark'); audio.event('win'); audio.destroy(); audio.destroy();
  m.nodes.forEach(node => { assert.equal(node.destroys, 1); assert.ok(node.stops); node.error(); node.ended(); });
  audio.resume(); audio.unlock(); audio.configure({ music: true }); audio.setMusicPaused(false); audio.event('correct');
  assert.deepEqual(audio.getState().playing, []); assert.equal(m.nodes[0].plays, 1);
});

test('网页音频使用同源路径，每次短声重新定位，销毁释放媒体', () => {
  const m = mockBrowser(), audio = createAudio({ window: m.window, settings: { music: true } });
  audio.unlock(); audio.event('correct'); audio.event('error');
  assert.equal(m.nodes.length, 3); assert.equal(m.nodes[0].src, '../audio-assets/bgm_rain_piano.mp3');
  assert.equal(m.nodes[1].src, '../assets/audio/mark_cat.mp3'); assert.equal(m.nodes[2].src, '../assets/audio/mark_wrong_1.mp3');
  assert.equal(m.nodes[2].currentTime, 0); assert.equal(m.nodes[2].pauses, 1);
  m.nodes[1].events.ended(); assert.deepEqual(audio.getState().playing, ['music', 'sound']);
  audio.destroy(); m.nodes.forEach(node => { assert.equal(node.src, ''); assert.equal(node.loaded, true); });
});

test('浏览器拒绝自动播放后，下一次实际触摸可再尝试音乐', async () => {
  const m = mockBrowser(true), audio = createAudio({ window: m.window, settings: { music: true } });
  audio.unlock(); await Promise.resolve(); assert.deepEqual(audio.getState().playing, []);
  audio.unlock(); assert.equal(m.nodes[0].plays, 2); await Promise.resolve();
  audio.destroy();
});

test('设备缺少音频 API 时仍可正常游玩', () => {
  const audio = createAudio({ wx: {}, window: {} });
  audio.unlock(); assert.equal(audio.event('win'), false); audio.pause(); audio.resume(); audio.destroy();
  assert.equal(audio.getState().available, false);
});

test('微信音乐分包只在实际开启并解锁后加载，同一请求期间不重复加载且不阻塞音效', () => {
  const m = mockWechat(true), audio = createAudio({ wx: m.wx });
  audio.unlock(); assert.equal(m.requests.length, 0);
  audio.configure({ music: true }); audio.unlock(); audio.resume(); audio.configure({ music: true });
  assert.equal(m.requests.length, 1); assert.equal(m.nodes.length, 0);
  audio.event('correct'); assert.equal(m.nodes.length, 1); assert.match(m.nodes[0].src, /mark_cat.mp3/);
  m.requests[0].success(); assert.equal(m.nodes.length, 2); assert.equal(m.nodes[1].plays, 1);
  audio.unlock(); assert.equal(m.requests.length, 1); assert.equal(m.nodes[1].plays, 1);
});

test('音乐分包异步完成时遵守关闭、后台和销毁状态，不补播曾经请求的声音', () => {
  for (const state of ['off', 'hidden', 'destroyed']) {
    const m = mockWechat(true), audio = createAudio({ wx: m.wx, settings: { music: true } }); audio.unlock();
    if (state === 'off') audio.configure({ music: false });
    if (state === 'hidden') audio.pause();
    if (state === 'destroyed') audio.destroy();
    m.requests[0].success(); assert.equal(m.nodes.length, 0, state); assert.deepEqual(audio.getState().playing, []);
    if (state === 'off') { audio.configure({ music: true }); assert.equal(m.nodes[0].plays, 1); }
    if (state === 'hidden') { audio.resume(); assert.equal(m.nodes[0].plays, 1); }
    if (state === 'destroyed') { audio.resume(); audio.unlock(); assert.equal(m.nodes.length, 0); }
    assert.equal(m.requests.length, 1, state);
  }
});

test('音乐分包失败不循环请求，下次实际操作可重试且不会积压音效', () => {
  const m = mockWechat(true), audio = createAudio({ wx: m.wx, settings: { music: true } }); audio.unlock();
  m.requests[0].fail(); assert.equal(m.requests.length, 1); assert.equal(m.nodes.length, 0);
  audio.event('click'); assert.equal(m.nodes.length, 1); audio.unlock(); assert.equal(m.requests.length, 2);
  m.requests[1].success(); assert.equal(m.nodes.length, 2); assert.equal(m.nodes[0].plays, 1); assert.equal(m.nodes[1].plays, 1);
});

test('开场和过关声暂时暂停音乐，多个暂停声全部结束后才恢复', () => {
  const m = mockWechat(), audio = createAudio({ wx: m.wx, settings: { music: true } }); audio.unlock();
  const music = m.nodes[0]; audio.event('board'); audio.event('win');
  assert.deepEqual(audio.getState().playing, ['sound']); assert.ok(music.pauses);
  forFile(m, 'board_enter_1')[0].ended(); assert.equal(music.plays, 1);
  forFile(m, 'level_win')[0].ended(); assert.equal(music.plays, 2); assert.deepEqual(audio.getState().playing, ['music']);
  audio.event('board'); audio.configure({ sound: false }); assert.equal(music.plays, 3);
  forFile(m, 'board_enter_1')[0].ended(); assert.equal(music.plays, 3);
});

test('暂停音乐期间载入完成也不会提前播放，音效失败会释放临时暂停', async () => {
  const m = mockWechat(true), audio = createAudio({ wx: m.wx, settings: { music: true } }); audio.unlock();
  audio.event('win'); m.requests[0].success(); assert.equal(m.nodes.length, 1);
  m.nodes[0].error(); assert.equal(m.nodes.length, 2); assert.equal(m.nodes[1].plays, 1);
  const win = m.nodes[0]; win.nextPlay = () => Promise.reject(new Error('播放失败'));
  audio.event('win'); assert.deepEqual(audio.getState().playing, ['sound']);
  await Promise.resolve(); assert.equal(m.nodes[1].plays, 2);
  win.nextPlay = () => { throw new Error('同步失败'); };
  assert.equal(audio.event('win'), false); assert.deepEqual(audio.getState().playing, ['music']);
});

test('重复短声时旧播放的 Promise 拒绝不会截断新播放', async () => {
  const m = mockBrowser(), audio = createAudio({ window: m.window }); audio.unlock(); audio.event('hint');
  let reject; m.nodes[0].nextPlay = () => new Promise((resolve, fail) => { reject = fail; });
  audio.event('hint'); m.nodes[0].nextPlay = () => Promise.resolve(); audio.event('hint');
  reject(new Error('旧播放已取消')); await Promise.resolve();
  assert.deepEqual(audio.getState().playing, ['sound']); assert.equal(m.nodes.length, 1);
});

test('失败页持续暂停背景音乐但仍播放失败音效，离开后遵守设置和后台状态', () => {
  const m = mockWechat(), audio = createAudio({ wx: m.wx, settings: { music: true } }); audio.unlock();
  audio.setMusicPaused(true); audio.event('fail'); assert.deepEqual(audio.getState().playing, ['sound']);
  forFile(m, 'level_fail')[0].ended(); audio.unlock(); assert.equal(m.nodes[0].plays, 1);
  audio.pause(); audio.setMusicPaused(false); assert.equal(m.nodes[0].plays, 1);
  audio.resume(); assert.equal(m.nodes[0].plays, 2);
  audio.setMusicPaused(true); audio.configure({ music: false }); audio.setMusicPaused(false); assert.equal(m.nodes[0].plays, 2);
});

function mp3Info(bytes) {
  let offset = 0;
  if (bytes.toString('ascii', 0, 3) === 'ID3') {
    assert.ok(bytes.length >= 10);
    offset = 10 + ((bytes[6] & 127) * 2097152 + (bytes[7] & 127) * 16384 + (bytes[8] & 127) * 128 + (bytes[9] & 127));
    if (bytes[5] & 16) offset += 10;
  }
  const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const rates = [44100, 48000, 32000];
  let frames = 0, sampleRate;
  while (offset + 4 <= bytes.length) {
    if (bytes.toString('ascii', offset, offset + 3) === 'TAG' && offset + 128 === bytes.length) break;
    const header = bytes.readUInt32BE(offset);
    assert.equal(header >>> 21, 2047, '每个 MPEG 帧必须有同步字');
    assert.equal((header >>> 19) & 3, 3, '音频采用 MPEG-1');
    assert.equal((header >>> 17) & 3, 1, '音频采用 Layer III');
    sampleRate = rates[(header >>> 10) & 3]; const bitrate = bitrates[(header >>> 12) & 15];
    assert.equal(sampleRate, 44100); assert.equal(bitrate, 192); assert.notEqual((header >>> 6) & 3, 3, '保留双声道');
    const length = Math.floor(144000 * bitrate / sampleRate) + ((header >>> 9) & 1);
    assert.ok(offset + length <= bytes.length, '音频不能截断'); offset += length; frames++;
  }
  assert.ok(frames > 2, '必须存在实际音频帧'); assert.equal(offset, bytes.length);
  return { seconds: frames * 1152 / sampleRate };
}

test('音乐和11种音效是完整双声道 MP3，时长及包体符合预算', () => {
  const names = ['board_enter_1', 'mark_x_2', 'unmark_x_2', 'mark_cat', 'mark_wrong_1', 'use_hint',
    'all_cleared', 'level_win', 'level_fail', 'btn_click_2', 'dlg_open_1'];
  const effectDir = path.join(__dirname, '../assets/audio');
  assert.deepEqual(fs.readdirSync(effectDir).filter(name => /\.(mp3|wav)$/i.test(name)).sort(), names.map(name => name + '.mp3').sort());
  let effectTotal = 0;
  for (const name of names) {
    const bytes = fs.readFileSync(path.join(effectDir, name + '.mp3')); effectTotal += bytes.length;
    const info = mp3Info(bytes); assert.ok(info.seconds > .08 && info.seconds < 15, name);
    if (name === 'board_enter_1') assert.ok(Math.abs(info.seconds - 1.057) < .15);
    if (name === 'level_win') assert.ok(Math.abs(info.seconds - 4.736) < .15);
  }
  const music = fs.readFileSync(path.join(__dirname, '../audio-assets/bgm_rain_piano.mp3'));
  assert.ok(Math.abs(mp3Info(music).seconds - 79) < .15);
  assert.ok(effectTotal < 1024 * 1024); assert.ok(music.length < 2 * 1024 * 1024);
});

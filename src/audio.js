(function () {
  'use strict';

  const EFFECTS = {
    correct: ['mark_cat', 3], helper: ['mark_cat', 3],
    error: ['mark_wrong_1', 2], hint: ['use_hint', 1], checkin: ['use_hint', 1],
    win: ['level_win', 1, true], click: ['btn_click_2', 4],
    board: ['board_enter_1', 1, true], mark: ['mark_x_2', 4], unmark: ['unmark_x_2', 4],
    fail: ['level_fail', 1], dialog: ['dlg_open_1', 1], clear: ['all_cleared', 1]
  };

  function createAudio(options) {
    options = options || {};
    const wechat = options.wx || (typeof wx !== 'undefined' ? wx : null);
    const browser = options.window || (typeof window !== 'undefined' ? window : null);
    const isWechat = !!(wechat && typeof wechat.createInnerAudioContext === 'function');
    const basePath = options.basePath || (isWechat ? 'assets/audio/' : '../assets/audio/');
    const musicPath = options.musicPath || (isWechat ? 'audio-assets/' : '../audio-assets/');
    const initial = options.settings || {};
    const settings = { music: typeof initial.music === 'boolean' ? initial.music : false,
      sound: typeof initial.sound === 'boolean' ? initial.sound : true };
    const pools = {};
    let musicLane = null, serial = 0;
    let unlocked = false, hidden = false, destroyed = false, musicPaused = false;
    let musicPackage = isWechat && typeof wechat.loadSubpackage === 'function' ? 'unloaded' : 'ready';

    function stop(lane, rewind) {
      if (!lane) return;
      lane.epoch++;
      try {
        if (isWechat && rewind) lane.node.stop();
        else {
          lane.node.pause();
          if (rewind) lane.node.currentTime = 0;
        }
      } catch (_) { /* 未加载完毕时允许停止失败，下次播放会重新定位。 */ }
      lane.playing = false;
    }

    function effectLanes() { return Object.keys(pools).flatMap(name => pools[name]); }

    function createLane(category, file, pausesMusic) {
      let node;
      try {
        if (isWechat) node = wechat.createInnerAudioContext();
        else if (browser && typeof browser.Audio === 'function') node = new browser.Audio();
        else return null;
      } catch (_) { return null; }
      const lane = { node, playing: false, pausesMusic: !!pausesMusic, epoch: 0, serial: 0 };
      node.loop = category === 'music';
      node.autoplay = false;
      node.volume = 1;
      node.src = (category === 'music' ? musicPath : basePath) + file + '.mp3';
      function finish() {
        const blockedMusic = lane.playing && lane.pausesMusic;
        lane.playing = false;
        lane.epoch++;
        if (blockedMusic) music();
      }
      if (isWechat) {
        node.obeyMuteSwitch = true;
        if (typeof node.onError === 'function') node.onError(finish);
        if (typeof node.onEnded === 'function') node.onEnded(finish);
      } else {
        node.preload = 'auto';
        if (typeof node.addEventListener === 'function') {
          node.addEventListener('error', finish);
          node.addEventListener('ended', finish);
        }
      }
      return lane;
    }

    function playLane(lane, restart) {
      if (!lane) return false;
      if (restart) stop(lane, true);
      const epoch = ++lane.epoch;
      lane.playing = true;
      lane.serial = ++serial;
      try {
        const promise = lane.node.play();
        // 只处理本次播放的拒绝；旧 Promise 不会截断同一声道的新播放。
        if (promise && typeof promise.catch === 'function') promise.catch(() => {
          if (lane.epoch !== epoch) return;
          lane.playing = false;
          if (lane.pausesMusic) music();
        });
        return true;
      } catch (_) {
        lane.playing = false;
        return false;
      }
    }

    function music() {
      if (!unlocked || hidden || destroyed || musicPaused || !settings.music || (musicLane && musicLane.playing)) return;
      if (effectLanes().some(lane => lane.playing && lane.pausesMusic)) return;
      if (musicPackage === 'loading') return;
      if (musicPackage === 'unloaded') {
        musicPackage = 'loading';
        try {
          wechat.loadSubpackage({ name: 'audio', success() {
            musicPackage = 'ready';
            // 加载期间的关闭、切后台及销毁状态以此刻为准，不补播短音效。
            music();
          }, fail() { musicPackage = 'unloaded'; } });
        } catch (_) { musicPackage = 'unloaded'; }
        return;
      }
      if (!musicLane) musicLane = createLane('music', 'bgm_rain_piano', false);
      playLane(musicLane, false);
    }

    function configure(next) {
      if (destroyed) return;
      for (const key of ['music', 'sound']) {
        if (!next || typeof next[key] !== 'boolean') continue;
        settings[key] = next[key];
        if (!settings[key]) {
          if (key === 'music') stop(musicLane, true);
          else effectLanes().forEach(lane => stop(lane, true));
        }
      }
      music();
    }

    function unlock() {
      if (destroyed) return;
      unlocked = true;
      music();
    }

    function event(name) {
      const effect = EFFECTS[name];
      if (destroyed || hidden || !unlocked || !settings.sound || !effect) return false;
      const [file, limit, pausesMusic] = effect;
      const pool = pools[file] || (pools[file] = []);
      let lane = pool.find(item => !item.playing);
      if (!lane && pool.length < limit) {
        lane = createLane('sound', file, pausesMusic);
        if (lane) pool.push(lane);
      }
      // 达到并发上限后复用最早的声道，连续划叉不会无限堆积。
      if (!lane && pool.length) lane = pool.reduce((oldest, item) => item.serial < oldest.serial ? item : oldest);
      if (!playLane(lane, true)) { music(); return false; }
      if (pausesMusic) stop(musicLane, false);
      return true;
    }

    function pause() {
      if (destroyed) return;
      hidden = true;
      stop(musicLane, false);
      effectLanes().forEach(lane => stop(lane, true));
    }

    function setMusicPaused(value) {
      if (destroyed) return;
      const next = !!value;
      if (musicPaused === next) return;
      musicPaused = next;
      if (musicPaused) stop(musicLane, false);
      else music();
    }

    function resume() {
      if (destroyed) return;
      hidden = false;
      music();
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      const lanes = effectLanes();
      if (musicLane) lanes.push(musicLane);
      lanes.forEach(lane => {
        stop(lane, true);
        if (isWechat && typeof lane.node.destroy === 'function') lane.node.destroy();
        else { lane.node.src = ''; if (typeof lane.node.load === 'function') lane.node.load(); }
      });
    }

    return {
      configure, unlock, event, pause, resume, destroy, setMusicPaused,
      getState() {
        const playing = [];
        if (musicLane && musicLane.playing) playing.push('music');
        if (effectLanes().some(lane => lane.playing)) playing.push('sound');
        return { available: isWechat || !!(browser && typeof browser.Audio === 'function'), unlocked, hidden, destroyed,
          settings: Object.assign({}, settings), playing };
      }
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createAudio };
  else if (typeof window !== 'undefined') window.MeowAudio = { createAudio };
})();

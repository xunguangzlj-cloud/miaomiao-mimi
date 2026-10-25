'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const modules = ['platform', 'logic', 'levels', 'cosmetics', 'cosmetic-art', 'progression', 'audio', 'input-ui', 'sprite-frames', 'ui-frames', 'cat-frames', 'garden-frames', 'garden-art', 'level-data', 'home-flow', 'art', 'tutorial', 'game', 'quotes', 'splash', 'boot'];
const parts = modules.map(name => JSON.stringify(name) + ':function(module,exports,require){\n' + fs.readFileSync(path.join(root, 'src', name + '.js'), 'utf8') + '\n}');
const bundle = `(function(){
'use strict';
const factories={${parts.join(',\n')}};
const cache={};
function load(name){
  if(name.startsWith('./')) name=name.slice(2);
  if(name.endsWith('.js')) name=name.slice(0,-3);
  if(!cache[name]){const m={exports:{}};cache[name]=m;factories[name](m,m.exports,load);}
  return cache[name].exports;
}
const canvas=document.getElementById('game');
const status=document.getElementById('status');
const mobile=window.innerWidth<=760;
const width=mobile?Math.min(390,window.innerWidth):390;
const height=mobile?window.innerHeight:Math.min(780,Math.max(568,window.innerHeight-56));
canvas.style.height=height+'px';canvas.style.aspectRatio='auto';
const names={loading:'正在进入小屋',home:'小屋首页',ranking:'排行榜',tutorial:'新手教学',play:'正在找猫',levels:'选择关卡',rules:'玩法说明',settings:'小屋设置',profile:'个人资料',wardrobe:'动物小屋',checkin:'每日打卡',feedback:'反馈',win:'猫咪都到家了',fail:'再试一次',restart:'重新开始',newgame:'已有未完成的棋局'};
let restoreScreen='';
try{restoreScreen=window.sessionStorage.getItem('miaoge-resize-screen')||'';window.sessionStorage.removeItem('miaoge-resize-screen');}catch(_){}
const app=load('boot').startApp({canvas,width,height,onState:s=>{
  canvas.setAttribute('aria-label',s.screen==='loading'?'启动加载页：随机名言、猫头像和资源进度条。':'找猫棋盘。单击标记，双击放猫，也可切换放置模式。');
  status.textContent=names[s.screen]+(s.screen==='loading'?' · '+Math.floor(s.progress*100)+'% · '+s.quote.text+' — '+s.quote.author:'')+(s.screen==='play'?' · 第'+s.levelId+'关 · 分数'+s.score+' · 已找到'+s.cats+'/'+s.size+' · 剩余'+s.hearts+'份生命':'')+(s.message&&['play','tutorial'].includes(s.screen)?'。'+s.message:'');
},onReady:game=>{
  if(['play','fail'].includes(restoreScreen)) game.resume();
  else if(['checkin','profile','wardrobe','settings'].includes(restoreScreen)) game.openPage(restoreScreen);
}});
// 大幅调整预览窗口时保存并重新适配，输入昵称时不打断键盘。
let resizeTimer;
const originalWidth=window.innerWidth, originalHeight=window.innerHeight;
window.addEventListener('resize',()=>{
  clearTimeout(resizeTimer);
  resizeTimer=setTimeout(()=>{
    if(document.activeElement&&document.activeElement.tagName==='INPUT') return;
    if(window.innerWidth===originalWidth&&Math.abs(window.innerHeight-originalHeight)<80) return;
    const state=app.getState();app.stop();
    try{window.sessionStorage.setItem('miaoge-resize-screen',state.screen);}catch(_){}
    window.location.reload();
  },180);
});
})();\n`;
// 网页预览独立打包，正式微信包不包含这一文件。
fs.mkdirSync(path.join(root, 'web'), { recursive: true });
fs.writeFileSync(path.join(root, 'web', 'preview.js'), bundle);
console.log('网页预览已生成：' + Buffer.byteLength(bundle) + ' 字节');

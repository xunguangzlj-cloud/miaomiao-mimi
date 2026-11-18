'use strict';

// 保留已有外观标识，旧存档仍能选中原来的小屋和头像框。
const THEMES = [
  { id: 'cream', name: '奶油小屋', level: 1, paper: '#F7F2EF', ink: '#935A5A', accent: '#F49419', style: 'none' },
  { id: 'forest', name: '薄荷花园', level: 3, paper: '#F0F5EC', ink: '#59745D', accent: '#87B68E', style: 'leaf' },
  { id: 'sky', name: '云朵书房', level: 5, paper: '#EFF5FA', ink: '#557188', accent: '#8FBDDB', style: 'cloud' },
  { id: 'rose', name: '樱花茶室', level: 8, paper: '#FCF0F1', ink: '#915D72', accent: '#DDA0B1', style: 'flower' },
  { id: 'night', name: '星月露台', level: 12, paper: '#F0EDF7', ink: '#6D658A', accent: '#A49BCB', style: 'moon' },
  { id: 'royal', name: '金色庆典', level: 21, paper: '#FAF1DE', ink: '#896136', accent: '#DFAD51', style: 'sun' },
  { id: 'ocean', name: '海盐小院', level: 10, paper: '#EDF6F4', ink: '#4C7475', accent: '#83BDBB', style: 'wave' },
  { id: 'tea', name: '雨声茶舍', level: 14, paper: '#F1F2EC', ink: '#607363', accent: '#98ADA1', style: 'rain' },
  { id: 'candy', name: '糖果工坊', level: 18, paper: '#FBF0F6', ink: '#88627D', accent: '#C9A1C6', style: 'candy' },
  { id: 'wood', name: '暖木森林', level: 23, paper: '#F6EFE5', ink: '#7F6249', accent: '#B99877', style: 'wood' },
  { id: 'snow', name: '初雪暖阁', level: 26, paper: '#F0F5F7', ink: '#5B7082', accent: '#A7C4D2', style: 'snow' },
  { id: 'lotus', name: '荷风水庭', level: 30, paper: '#F3F4E9', ink: '#62734F', accent: '#A3B982', style: 'lotus' }
].sort((a, b) => a.level - b.level);
const FRAMES = [
  { id: 'basic', name: '奶油圆角', level: 1, color: '#FDF9F0', detail: '#CDBCA6', style: 'basic' },
  { id: 'mint', name: '薄荷叶环', level: 3, color: '#93C5AB', detail: '#5F9677', style: 'leaf' },
  { id: 'gold', name: '暖阳日冕', level: 8, color: '#EDC46B', detail: '#CF963B', style: 'sun' },
  { id: 'cosmic', name: '星月之约', level: 21, color: '#B8ADD8', detail: '#8279B0', style: 'moon' },
  { id: 'blossom', name: '樱花花环', level: 5, color: '#E9B0BC', detail: '#C68699', style: 'flower' },
  { id: 'ocean', name: '海浪贝壳', level: 12, color: '#98C8CB', detail: '#699DA4', style: 'wave' },
  { id: 'wood', name: '暖木相框', level: 16, color: '#C3A487', detail: '#937457', style: 'wood' },
  { id: 'bow', name: '蜜桃蝴蝶结', level: 30, color: '#E6B8B0', detail: '#BF8C89', style: 'bow' }
].sort((a, b) => a.level - b.level);

module.exports = { THEMES, FRAMES };

'use strict';

// 只收录核对过原典的公版名言；简繁转换与标点整理不改变原句含义。
const QUOTES = [
  { text: '三人行，必有我师焉。择其善者而从之，其不善者而改之。', author: '孔子', work: '《论语·述而》', source: 'https://zh.wikisource.org/wiki/論語/述而第七' },
  { text: '吾尝终日而思矣，不如须臾之所学也；吾尝跂而望矣，不如登高之博见也。', author: '荀子', work: '《荀子·劝学》', source: 'https://zh.wikisource.org/zh-hans/劝学' },
  { text: '故不积跬步，无以至千里；不积小流，无以成江海。', author: '荀子', work: '《荀子·劝学》', source: 'https://zh.wikisource.org/zh-hans/劝学' },
  { text: '骐骥一跃，不能十步；驽马十驾，功在不舍。', author: '荀子', work: '《荀子·劝学》', source: 'https://zh.wikisource.org/zh-hans/劝学' },
  { text: '锲而舍之，朽木不折；锲而不舍，金石可镂。', author: '荀子', work: '《荀子·劝学》', source: 'https://zh.wikisource.org/zh-hans/劝学' },
  { text: '天下难事，必作于易；天下大事，必作于细。', author: '老子', work: '《道德经》第六十三章', source: 'https://zh.wikisource.org/wiki/道德經_(王弼本)#六十三章' },
  { text: '合抱之木，生于毫末；九层之台，起于累土；千里之行，始于足下。', author: '老子', work: '《道德经》第六十四章', source: 'https://zh.wikisource.org/wiki/道德經_(王弼本)#六十四章' },
  { text: '夫君子之行，静以修身，俭以养德；非淡泊无以明志，非宁静无以致远。', author: '诸葛亮', work: '《诫子书》', source: 'https://zh.wikisource.org/zh-hans/戒子' },
  { text: '默而识之，学而不厌，诲人不倦，何有于我哉？', author: '孔子', work: '《论语·述而》', source: 'https://zh.wikisource.org/wiki/論語/述而第七' },
  { text: '博观而约取，厚积而薄发，吾告子止于此矣。', author: '苏轼', work: '《稼说送张琥》', source: 'https://zh.wikisource.org/wiki/稼說（送張琥）' }
];

function pickQuote(random = Math.random) {
  const value = random();
  const index = Number.isFinite(value) ? Math.max(0, Math.min(QUOTES.length - 1, Math.floor(value * QUOTES.length))) : 0;
  return QUOTES[index];
}

module.exports = { QUOTES, pickQuote };

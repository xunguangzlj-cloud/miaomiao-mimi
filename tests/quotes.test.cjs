'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { QUOTES, pickQuote } = require('../src/quotes');

test('启动名言保留简短原文、真实署名和可核对的原典地址', () => {
  assert.equal(QUOTES.length, 10);
  assert.equal(new Set(QUOTES.map(quote => quote.text)).size, QUOTES.length);
  for (const quote of QUOTES) {
    assert.ok(quote.text.length >= 20 && quote.text.length <= 45, quote.text);
    assert.ok(quote.author.length > 0 && quote.work.length > 0);
    assert.equal(new URL(quote.source).hostname, 'zh.wikisource.org');
    assert.ok(!/佛陀|爱因斯坦/.test(quote.author));
  }
});

test('随机区间覆盖全部名言，不偏离对应索引', () => {
  for (let index = 0; index < QUOTES.length; index++) {
    assert.equal(pickQuote(() => (index + 0.5) / QUOTES.length), QUOTES[index]);
  }
});

test('随机数处于端点或超出区间时仍返回有效名言', () => {
  for (const value of [-1, 0]) assert.equal(pickQuote(() => value), QUOTES[0]);
  for (const value of [0.999999, 1, 2]) assert.equal(pickQuote(() => value), QUOTES[QUOTES.length - 1]);
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(pickQuote(() => value), QUOTES[0]);
});

test('一次选取只读取一次随机数，默认选取也属于名言库', () => {
  let calls = 0;
  const quote = pickQuote(() => { calls++; return 0.5; });
  assert.equal(calls, 1);
  assert.equal(quote, QUOTES[5]);
  assert.ok(QUOTES.includes(pickQuote()));
});

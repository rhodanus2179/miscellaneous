import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMailParticipantContext, mailParticipantContextToSpans } from '../js/mail-context.js';

test('learns named participants from mail headers and masks repeated mentions deterministically', () => {
  const source = `八百屋 さやか\n西村 富男 (NISHIMURA Tomio);\n村上 友章\n西村さま\n西村さんの情報提供ありがとうございます。\n八百屋\nFrom: 西村 富男 (NISHIMURA Tomio) <tomio.nishimura@exri.co.jp>\nTo: 八百屋 さやか <sayaka.yaoya@exri.co.jp>; 村上 友章 <t-murakami@exri.co.jp>\nCc: 原竹 優弥 <yuya.haratake@exri.co.jp>; 林 雅樹 <masaki.hayashi@exri.co.jp>\n㈱エックス都市研究所 西村富男`;
  const context = extractMailParticipantContext(source);
  assert.equal(context.participants.length, 5);
  const spans = mailParticipantContextToSpans(source, 0, context);
  const texts = new Set(spans.map((x) => x.text));
  assert.ok(texts.has('西村 富男 (NISHIMURA Tomio)'));
  assert.ok(texts.has('八百屋 さやか'));
  assert.ok(texts.has('西村富男'));
  assert.ok(texts.has('西村'));
  assert.ok(texts.has('tomio.nishimura@exri.co.jp'));
  assert.ok(texts.has('sayaka.yaoya@exri.co.jp'));
});

test('does not learn organization display names as people', () => {
  const source = 'To: 戦略的バイオマスチーム <team@example.com>; 山田 太郎 <taro@example.com>';
  const context = extractMailParticipantContext(source);
  assert.deepEqual(context.participants.map((x) => x.display), ['山田 太郎']);
});

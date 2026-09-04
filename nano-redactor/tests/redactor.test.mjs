import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaskState, redactText } from '../js/redactor.js';

test('redactor changes only configured spans and preserves surrounding text exactly', () => {
  const source = '件名\t確認\r\n- 氏名: 田中太郎 🙂\r\n- URL: https://example.com/a?x=1  \r\n以上。';
  const name = '田中太郎'; const start = source.indexOf(name);
  const { text } = redactText(source, [{ start, end: start + name.length, type: 'PERSON' }]);
  assert.equal(text, '件名\t確認\r\n- 氏名: [氏名] 🙂\r\n- URL: https://example.com/a?x=1  \r\n以上。');
});

test('serial labels reuse the same label for the same exact original string', () => {
  const source = '田中太郎から田中太郎へ。山田花子にも連絡。';
  const first = source.indexOf('田中太郎'); const second = source.indexOf('田中太郎', first + 1); const third = source.indexOf('山田花子');
  const spans = [{ start:first, end:first+4, type:'PERSON' },{ start:second, end:second+4, type:'PERSON' },{ start:third, end:third+4, type:'PERSON' }];
  const { text } = redactText(source, spans, { style:'serial', state:createMaskState() });
  assert.equal(text, '[PERSON_01]から[PERSON_01]へ。[PERSON_02]にも連絡。');
});

test('black mask uses Unicode code points rather than UTF-16 units', () => {
  const { text } = redactText('A🙂B', [{ start:1, end:3, type:'OTHER' }], { style:'block' });
  assert.equal(text, 'A█B');
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatChatLabel, formatPhoneDigits, truncateLabel } from './chatLabel.ts';

describe('formatPhoneDigits', () => {
  it('formats Indonesian numbers', () => {
    assert.equal(formatPhoneDigits('6281234567890'), '+62 812 3456 7890');
  });
});

describe('truncateLabel', () => {
  it('leaves short strings alone', () => {
    assert.equal(truncateLabel('Alice', 16), 'Alice');
  });
  it('truncates long strings', () => {
    assert.equal(truncateLabel('A very long contact name here', 10), 'A very lo…');
  });
});

describe('formatChatLabel', () => {
  it('prefers a real chat name', () => {
    const l = formatChatLabel('62812@c.us', 'Alice');
    assert.equal(l.kind, 'named');
    assert.equal(l.full, 'Alice');
  });

  it('formats phone JIDs', () => {
    const l = formatChatLabel('6281234567890@c.us', null);
    assert.equal(l.kind, 'phone');
    assert.match(l.full, /^\+62/);
  });

  it('normalizes privacy LIDs instead of showing raw numbers', () => {
    const l = formatChatLabel('101425686311005@lid', null);
    assert.equal(l.kind, 'lid');
    assert.match(l.full, /Private contact/);
    assert.ok(!l.full.includes('101425686311005'));
  });

  it('treats bare long digit ids as privacy lids', () => {
    const l = formatChatLabel('113821029031988', null);
    assert.equal(l.kind, 'lid');
    assert.match(l.short, /Private/);
  });

  it('labels groups', () => {
    const l = formatChatLabel('120363@g.us', null);
    assert.equal(l.kind, 'group');
    assert.match(l.full, /^Group/);
  });

  it('ignores names that are just the raw id digits', () => {
    const l = formatChatLabel('101425686311005@lid', '101425686311005');
    assert.equal(l.kind, 'lid');
  });
});

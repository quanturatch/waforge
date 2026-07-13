import { bodyMatchesKeywords, normalizeForMatch, parseKeywordList } from './keyword-match';

describe('keyword-match', () => {
  describe('parseKeywordList', () => {
    it('splits on commas and normalizes', () => {
      expect(parseKeywordList('Happy Birthday, HBD,  congrats ')).toEqual([
        'happy birthday',
        'hbd',
        'congrats',
      ]);
    });

    it('drops empties and duplicates', () => {
      expect(parseKeywordList('hbd,,HBD,hbd')).toEqual(['hbd']);
    });
  });

  describe('bodyMatchesKeywords', () => {
    const kws = parseKeywordList('happy birthday,hbd,birthady');

    it('matches multi-word phrase ignoring case and punctuation', () => {
      expect(bodyMatchesKeywords('!!! Happy Birthday !!!', kws)).toBe('happy birthday');
    });

    it('matches typo keyword when configured', () => {
      expect(bodyMatchesKeywords('happy birthady dear', kws)).toBe('birthady');
    });

    it('returns null when no match', () => {
      expect(bodyMatchesKeywords('hello team meeting at 3', kws)).toBeNull();
    });

    it('matches hbd token inside longer text', () => {
      expect(bodyMatchesKeywords('wish you hbd bro', kws)).toBe('hbd');
    });
  });

  describe('normalizeForMatch', () => {
    it('collapses whitespace and lowercases', () => {
      expect(normalizeForMatch('  Happy   Birthday  ')).toBe('happy birthday');
    });
  });
});

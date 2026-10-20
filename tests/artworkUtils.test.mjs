import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// GNOME's GJS imports aren't available under Node. Load this pure helper module
// as a data URL so the actual exported functions can still be unit-tested.
const source = await readFile(new URL('../src/artworkUtils.js', import.meta.url), 'utf8');
const helpers = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('TMDB candidates ascend from small widths and preserve query string', () => {
    const result = helpers.buildArtworkCandidates(
        'https://image.tmdb.org/t/p/original/poster.jpg?token=abc',
    );
    assert.equal(result.isTmdbArtwork, true);
    assert.deepEqual(
        result.candidates.map((url) => url.match(/\/t\/p\/([^/]+)\//)[1]),
        ['w185', 'w342', 'w500', 'w780', 'w1280', 'original'],
    );
    assert.ok(result.candidates.every((url) => url.endsWith('?token=abc')));
});

test('preview dimensions respect monitor margins and preserve aspect ratio', () => {
    assert.deepEqual(
        helpers.fitArtworkToScreen(500, 750, 1366, 768),
        { width: 445, height: 668 },
    );
});

test('w500 is enough for a 768px-high monitor when source is portrait 2:3', () => {
    const display = helpers.fitArtworkToScreen(185, 278, 1366, 768);
    const needed = helpers.getRequiredSourceWidth(185, 278, display);
    const candidates = helpers.buildArtworkCandidates(
        'https://image.tmdb.org/t/p/original/poster.jpg',
    ).candidates;
    assert.equal(needed, 468);
    assert.equal(helpers.findNextSuitableTmdbCandidate(candidates, 0, needed), 2);
});

test('large source is accepted without an unnecessary escalation', () => {
    const display = helpers.fitArtworkToScreen(500, 750, 1366, 768);
    assert.equal(helpers.isArtworkResolutionEnough(500, 750, display), true);
});

test('YouTube placeholder sizes are recognized', () => {
    assert.equal(helpers.getYouTubeMinimumWidth('https://i.ytimg.com/vi/id/maxresdefault.jpg'), 800);
    assert.equal(helpers.getYouTubeMinimumWidth('https://i.ytimg.com/vi/id/hqdefault.jpg'), 320);
});

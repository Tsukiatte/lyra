import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildResult, buildTimeline, choose, cleanTitle, parseLRC, parseLyricsfile } from '../js/lyrics.js';

test('parseLRC reads timestamps, fractions and multi-stamp lines', () => {
  const lines = parseLRC('[ar:Someone]\n[00:01.5]One\n[00:02.25][00:10.00]Chorus\n[01:02.123] Three \nno timestamp');
  assert.deepEqual(lines.map((l) => [l.start, l.text]), [
    [1500, 'One'],
    [2250, 'Chorus'],
    [10000, 'Chorus'],
    [62123, 'Three'],
  ]);
});

test('parseLRC applies [offset:] (positive = show sooner)', () => {
  const [line] = parseLRC('[offset:+500]\n[00:02.00]Hi');
  assert.equal(line.start, 1500);
});

test('parseLRC reads enhanced word timings', () => {
  const [line] = parseLRC('[00:01.00]<00:01.00>Hello <00:01.60>bright <00:02.40>world<00:03.00>');
  assert.equal(line.text, 'Hello bright world');
  assert.deepEqual(line.words.map((w) => [w.text.trim(), w.start]), [['Hello', 1000], ['bright', 1600], ['world', 2400]]);
  assert.equal(line.words[2].end, 3000);
});

test('parseLyricsfile reads line- and word-synced YAML', () => {
  const src = `version: '1.0'
metadata:
  title: Test
lines:
- text: Yeah
  start_ms: 13130
  end_ms: 16560
- text: '''Cause it''s late'
  start_ms: 16560
  end_ms: 20000
  words:
    - text: "'Cause "
      start_ms: 16560
    - text: "it's "
      start_ms: 17100
    - text: late
      start_ms: 17800
      end_ms: 19000
`;
  const lines = parseLyricsfile(src);
  assert.equal(lines.length, 2);
  assert.deepEqual([lines[0].start, lines[0].end, lines[0].text], [13130, 16560, 'Yeah']);
  assert.equal(lines[0].words, null);
  assert.equal(lines[1].text, "'Cause it's late");
  assert.deepEqual(lines[1].words.map((w) => [w.text, w.start]), [["'Cause ", 16560], ["it's ", 17100], ['late', 17800]]);
  assert.equal(lines[1].words[2].end, 19000);
  assert.equal(lines[1].end, 20000, 'line keys after words still belong to the line');
});

test('parseLyricsfile handles indented list items', () => {
  const src = `lines:
  - text: "This was a triumph."
    words:
      - text: "This "
        start_ms: 290
      - text: "was "
        start_ms: 536
    start_ms: 290
    end_ms: 3840
`;
  const [line] = parseLyricsfile(src);
  assert.deepEqual([line.start, line.end, line.words.length], [290, 3840, 2]);
});

test('buildTimeline turns music notes into gaps and adds an intro gap', () => {
  const tl = buildTimeline(parseLRC('[00:13.13]Yeah\n[00:16.56]♪\n[00:27.16]I have been calling\n[00:29.96]Next line'), 60000);
  assert.deepEqual(tl.map((e) => (e.gap ? `gap ${e.start}-${e.end}` : `${e.text} ${e.start}-${e.end}`)), [
    'gap 0-13130',
    'Yeah 13130-16560',
    'gap 16560-27160',
    'I have been calling 27160-29960',
    'Next line 29960-60000',
  ]);
});

test('buildTimeline folds short gaps into the previous line', () => {
  const tl = buildTimeline(parseLRC('[00:01.00]A\n[00:03.00]♪\n[00:04.00]B'), 8000);
  assert.deepEqual(tl.map((e) => [e.gap ? 'gap' : e.text, e.start, e.end]), [['A', 1000, 4000], ['B', 4000, 8000]]);
});

test('buildTimeline splits suspiciously long lines into line + gap', () => {
  const tl = buildTimeline(parseLRC('[00:01.00]Short line\n[00:40.00]After the solo'), 60000);
  assert.equal(tl[0].text, 'Short line');
  assert.ok(tl[0].end < 10000);
  assert.equal(tl[1].gap, true);
  assert.equal(tl[1].end, 40000);
});

test('buildTimeline leaves a leading note-line gap starting at 0', () => {
  const tl = buildTimeline(parseLRC('[00:00.50]♪\n[00:09.00]Hello'), 20000);
  assert.deepEqual([tl[0].gap, tl[0].start, tl[0].end], [true, 0, 9000]);
});

test('buildResult picks the best available format', () => {
  assert.equal(buildResult(null).kind, 'none');
  assert.equal(buildResult({ none: true }).kind, 'none');
  assert.equal(buildResult({ instrumental: true }).kind, 'instrumental');
  assert.equal(buildResult({ synced: '[00:01.00]♪' , plain: 'words' }).kind, 'plain');
  const plain = buildResult({ plain: 'a\n\n\n\nb' });
  assert.deepEqual(plain.lines.map((l) => l.text), ['a', '', 'b']);
  assert.equal(buildResult({ synced: '[00:01.00]Hi' }, 5000).kind, 'synced');
});

test('cleanTitle strips remaster/feat noise but keeps the song name', () => {
  assert.equal(cleanTitle('Song Name - Remastered 2011'), 'Song Name');
  assert.equal(cleanTitle('Song Name (feat. Someone)'), 'Song Name');
  assert.equal(cleanTitle('Song Name - 2015 Version'), 'Song Name');
  assert.equal(cleanTitle('Song Name [Live at Wembley]'), 'Song Name');
  assert.equal(cleanTitle('Song - Name'), 'Song - Name');
  assert.equal(cleanTitle('Song Name (Remix)'), 'Song Name (Remix)');
});

test('choose prefers synced lyrics with matching title, artist and duration', () => {
  const track = { title: 'Glow', artists: ['Nova'], durationMs: 200000 };
  const list = [
    { trackName: 'Glow', artistName: 'Nova', duration: 240, syncedLyrics: 'x' },
    { trackName: 'Glow', artistName: 'Nova', duration: 201, plainLyrics: 'x' },
    { trackName: 'Glow', artistName: 'Nova', duration: 202, syncedLyrics: 'x' },
    { trackName: 'Other', artistName: 'Nova', duration: 200, syncedLyrics: 'x' },
  ];
  assert.equal(choose(list, track), list[2]);
  assert.equal(choose([{ trackName: 'Nope', artistName: 'Else', duration: 200, plainLyrics: 'x' }], track), null);
});

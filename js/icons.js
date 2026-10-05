const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
const line = (d, w = 1.8) =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

export const icons = {
  play: svg('<path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.53.85l10.4-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5Z"/>'),
  pause: svg('<rect fill="currentColor" x="6.5" y="5" width="4" height="14" rx="1.3"/><rect fill="currentColor" x="13.5" y="5" width="4" height="14" rx="1.3"/>'),
  next: svg('<path fill="currentColor" d="M5 6.6v10.8a1 1 0 0 0 1.55.83l8.1-5.4a1 1 0 0 0 0-1.66l-8.1-5.4A1 1 0 0 0 5 6.6Z"/><rect fill="currentColor" x="16.6" y="5.5" width="2.6" height="13" rx="1.3"/>'),
  prev: svg('<path fill="currentColor" d="M19 6.6v10.8a1 1 0 0 1-1.55.83l-8.1-5.4a1 1 0 0 1 0-1.66l8.1-5.4A1 1 0 0 1 19 6.6Z"/><rect fill="currentColor" x="4.8" y="5.5" width="2.6" height="13" rx="1.3"/>'),
  shuffle: svg(line('M3.5 7.5h2.8c1.9 0 3 .8 4 2.4l3.4 5.2c1 1.6 2.1 2.4 4 2.4h2.8M3.5 16.5h2.8c1.3 0 2.2-.4 3-1.2M14.7 8.7c.8-.8 1.7-1.2 3-1.2h2.8M18 4.8l2.6 2.7-2.6 2.7M18 14.8l2.6 2.7-2.6 2.7')),
  repeat: svg(line('M4.5 11.2V9.5a3 3 0 0 1 3-3h12M16.8 3.8l2.7 2.7-2.7 2.7M19.5 12.8v1.7a3 3 0 0 1-3 3h-12M7.2 20.2l-2.7-2.7 2.7-2.7')),
  repeatOne: svg(line('M4.5 11.2V9.5a3 3 0 0 1 3-3h12M16.8 3.8l2.7 2.7-2.7 2.7M19.5 12.8v1.7a3 3 0 0 1-3 3h-12M7.2 20.2l-2.7-2.7 2.7-2.7') + line('M11 10.4l1.4-.9v5', 1.6)),
  sliders: svg(line('M4 7.5h9M17.4 7.5H20M4 16.5h2.6M11.4 16.5H20') + line('M15.2 5.3a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4ZM8.8 14.3a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Z')),
  layout: svg(line('M6.7 4.5h10.6a3.2 3.2 0 0 1 3.2 3.2v8.6a3.2 3.2 0 0 1-3.2 3.2H6.7a3.2 3.2 0 0 1-3.2-3.2V7.7a3.2 3.2 0 0 1 3.2-3.2ZM10.5 4.5v15')),
  lyrics: svg(line('M4.5 7h15M4.5 12h10M4.5 17h12.5')),
  image: svg(line('M8 3.5h8a4.5 4.5 0 0 1 4.5 4.5v8a4.5 4.5 0 0 1-4.5 4.5H8A4.5 4.5 0 0 1 3.5 16V8A4.5 4.5 0 0 1 8 3.5ZM9 7.5a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4ZM20.3 15.2l-4.2-4.2a1.6 1.6 0 0 0-2.3 0L4.4 20.4')),
  expand: svg(line('M4.5 9V6A1.5 1.5 0 0 1 6 4.5h3M19.5 9V6A1.5 1.5 0 0 0 18 4.5h-3M4.5 15v3A1.5 1.5 0 0 0 6 19.5h3M19.5 15v3a1.5 1.5 0 0 1-1.5 1.5h-3')),
  close: svg(line('M6.5 6.5l11 11M17.5 6.5l-11 11')),
  check: svg(line('m5 12.6 4.3 4.3L19 7.2', 2.4)),
  minus: svg(line('M6.5 12h11', 2)),
  plus: svg(line('M12 6.5v11M6.5 12h11', 2)),
  car: svg(line('M5.2 16.8v-3.4c0-.5.1-.9.4-1.3l1.9-2.9a2.6 2.6 0 0 1 2.2-1.2h4.6c.9 0 1.7.4 2.2 1.2l1.9 2.9c.3.4.4.8.4 1.3v3.4M4.5 16.8h15M7 16.8v1.7M17 16.8v1.7') + '<circle cx="8.4" cy="13.6" r="1" fill="currentColor"/><circle cx="15.6" cy="13.6" r="1" fill="currentColor"/>'),
  speaker: svg(line('M9 3.5h6a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3ZM12 11.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z') + '<circle cx="12" cy="7.6" r="1" fill="currentColor"/>'),
  phone: svg(line('M9.6 3h4.8A2.6 2.6 0 0 1 17 5.6v12.8a2.6 2.6 0 0 1-2.6 2.6H9.6A2.6 2.6 0 0 1 7 18.4V5.6A2.6 2.6 0 0 1 9.6 3ZM11 18h2')),
  laptop: svg(line('M6.8 5.5h10.4A1.8 1.8 0 0 1 19 7.3v6.4a1.8 1.8 0 0 1-1.8 1.8H6.8A1.8 1.8 0 0 1 5 13.7V7.3a1.8 1.8 0 0 1 1.8-1.8ZM3 18.5h18')),
  music: svg(line('M9 18.5V6.2l10-2v12M6.8 16.2a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6ZM16.8 13.9a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6Z')),
  refresh: svg(line('M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4')),
  heart: svg('<path class="h-line" d="M12 20.1c-.3 0-.6-.1-.8-.3C7.6 16.8 3.5 13.3 3.5 9.2c0-2.7 2.1-4.7 4.6-4.7 1.6 0 3 .8 3.9 2.1.9-1.3 2.3-2.1 3.9-2.1 2.5 0 4.6 2 4.6 4.7 0 4.1-4.1 7.6-7.7 10.6-.2.2-.5.3-.8.3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path class="h-fill" d="M12 20.1c-.3 0-.6-.1-.8-.3C7.6 16.8 3.5 13.3 3.5 9.2c0-2.7 2.1-4.7 4.6-4.7 1.6 0 3 .8 3.9 2.1.9-1.3 2.3-2.1 3.9-2.1 2.5 0 4.6 2 4.6 4.7 0 4.1-4.1 7.6-7.7 10.6-.2.2-.5.3-.8.3Z" fill="currentColor"/>'),
  // Lyra's mark: a slanted L whose base trails off like a line being sung.
  logo: svg('<g transform="translate(2.8 0) skewX(-10)" fill="currentColor"><rect x="5" y="3.5" width="4.4" height="17" rx="1.1"/><rect x="5" y="16.1" width="8.6" height="4.4" rx="1.1"/><rect x="14.6" y="16.1" width="2.6" height="4.4" rx="1.1" opacity=".55"/><rect x="18.2" y="16.1" width="1.6" height="4.4" rx=".8" opacity=".28"/></g>'),
  copy: svg(line('M9 9h8.5a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 19v-8.5A1.5 1.5 0 0 1 9 9ZM15.5 9V5.5A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5H7.5')),
};

export function deviceIcon(type = '') {
  const t = type.toLowerCase();
  if (t === 'automobile') return icons.car;
  if (t === 'smartphone' || t === 'tablet') return icons.phone;
  if (t === 'computer') return icons.laptop;
  return icons.speaker;
}

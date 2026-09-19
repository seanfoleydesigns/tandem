// Simple custom icons, drawn for Tandem. 20 × 20, stroke only, currentColor. No third-party glyphs.
const svg = (body: string) =>
  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  mic: svg('<rect x="7.2" y="2.5" width="5.6" height="9.5" rx="2.8"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5M7.2 17.5h5.6"/>'),
  sound: svg('<path d="M3 8v4h3l4 3.2V4.8L6 8H3z"/><path d="M13 7.4a3.6 3.6 0 0 1 0 5.2M15.2 5.2a6.6 6.6 0 0 1 0 9.6"/>'),
  muted: svg('<path d="M3 8v4h3l4 3.2V4.8L6 8H3z"/><path d="M13.5 7.8l3.6 4.4M17.1 7.8l-3.6 4.4"/>'),
  memory: svg('<path d="M5.5 3h9a1 1 0 0 1 1 1v13l-5.5-3.4L4.5 17V4a1 1 0 0 1 1-1z"/>'),
  stop: '<svg viewBox="0 0 14 14" aria-hidden="true" focusable="false"><rect x="2" y="2" width="10" height="10" rx="2.2" fill="currentColor"/></svg>',
  check: '<svg class="check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3.2 8.4l3 3 6.6-6.8"/></svg>',
};

export const WAVE = '<span class="wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';

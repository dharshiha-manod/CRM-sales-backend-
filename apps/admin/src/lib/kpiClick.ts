import type { KeyboardEvent } from 'react';

export function kpiClick(active: boolean, onActivate: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-pressed': active,
    'data-clickable': 'true',
    'data-active': active ? 'true' : 'false',
    onClick: () => onActivate(),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onActivate();
      }
    },
  };
}

export function goToPage(page: string) {
  window.location.hash = page;
}
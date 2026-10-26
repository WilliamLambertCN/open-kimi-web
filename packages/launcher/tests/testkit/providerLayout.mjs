import { vi } from 'vitest';

export function mockProviderLayout(view) {
  vi.spyOn(view.Element.prototype, 'getClientRects').mockImplementation(function () {
    if (!this.isConnected || this.hidden || view.getComputedStyle(this).display === 'none') return [];
    for (let node = this.parentElement; node; node = node.parentElement) {
      if (node.hidden || view.getComputedStyle(node).display === 'none') return [];
    }
    return [{ width: 640, height: 400 }];
  });
}

// Measures the preview container and derives the page scale/arrangement.
// Guards for jsdom: no ResizeObserver means measure once and stay there.
import { useEffect, useState, type RefObject } from 'react';
import { CARD_PORTRAIT, computeCardScale, type CardScaleLayout } from '../../lib/card-scale.ts';

export function useCardScale(
  ref: RefObject<HTMLElement | null>,
  pageWidth: number = CARD_PORTRAIT.width,
): CardScaleLayout {
  const [layout, setLayout] = useState<CardScaleLayout>({ scale: 1, sideBySide: false });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => setLayout(computeCardScale(element.clientWidth, pageWidth));
    update();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, pageWidth]);

  return layout;
}

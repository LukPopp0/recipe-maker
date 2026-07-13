// Card preview container: toolbar (Back, orientation toggle, Print/Save
// PDF) plus the two letter-size pages inside scale frames. The frame div
// reserves the scaled footprint (transform does not affect layout size);
// print CSS strips the toolbar/labels and resets the scale so output is
// 1:1. Landscape is the template's original orientation and the default.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CanonicalRecipe } from 'shared';
import { CARD_LANDSCAPE, CARD_PORTRAIT, type CardPageDimensions } from '../../lib/card-scale.ts';
import { useCardScale } from './useCardScale.ts';
import { CardPage1 } from './CardPage1.tsx';
import { CardPage2 } from './CardPage2.tsx';
import './card.css';

export type CardOrientation = 'landscape' | 'portrait';

function PageFrame({
  scale,
  dimensions,
  label,
  children,
}: {
  scale: number;
  dimensions: CardPageDimensions;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="card-page-slot">
      <div
        className="card-page-frame"
        style={{ width: dimensions.width * scale, height: dimensions.height * scale }}
      >
        <div className="card-page-scaler" style={{ transform: `scale(${scale})` }}>
          {children}
        </div>
      </div>
      <p className="card-page-label">{label}</p>
    </div>
  );
}

// @page rules cannot be scoped by selector, so landscape print orientation
// is toggled by injecting a style element while the landscape card is shown.
function useLandscapePageStyle(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const style = document.createElement('style');
    style.textContent = '@page { size: letter landscape; margin: 0; }';
    document.head.appendChild(style);
    return () => style.remove();
  }, [active]);
}

export function CardView({ recipe, onBack }: { recipe: CanonicalRecipe; onBack: () => void }) {
  const [orientation, setOrientation] = useState<CardOrientation>('landscape');
  const landscape = orientation === 'landscape';
  const dimensions = landscape ? CARD_LANDSCAPE : CARD_PORTRAIT;
  const pagesRef = useRef<HTMLDivElement>(null);
  const { scale, sideBySide } = useCardScale(pagesRef, dimensions.width);

  useLandscapePageStyle(landscape);

  // The card usually replaces a long review page the user had scrolled down;
  // jump to the top so the card is in view (scrollY guard keeps jsdom quiet).
  useEffect(() => {
    if (window.scrollY > 0) window.scrollTo(0, 0);
  }, []);

  // Browsers use document.title as the default save-PDF filename, so the
  // printed card is named after the recipe instead of the app.
  useEffect(() => {
    const previous = document.title;
    const slug = recipe.title.toLowerCase().trim().replace(/\s+/g, '-');
    if (slug) document.title = slug;
    return () => {
      document.title = previous;
    };
  }, [recipe.title]);

  return (
    <div className={landscape ? 'card-view card-view--landscape' : 'card-view'}>
      <div className="card-view-toolbar">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setOrientation(landscape ? 'portrait' : 'landscape')}
        >
          {landscape ? 'Portrait layout' : 'Landscape layout'}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Print / Save PDF
        </button>
      </div>
      <div ref={pagesRef} className={sideBySide ? 'card-view-pages card-view-pages-row' : 'card-view-pages'}>
        <PageFrame scale={scale} dimensions={dimensions} label="Page 1">
          <CardPage1 recipe={recipe} orientation={orientation} />
        </PageFrame>
        <PageFrame scale={scale} dimensions={dimensions} label="Page 2">
          <CardPage2 recipe={recipe} orientation={orientation} />
        </PageFrame>
      </div>
    </div>
  );
}

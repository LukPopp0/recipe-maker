// Card preview container: toolbar (Back, Print/Save PDF) plus the two
// letter-size pages inside scale frames. The frame div reserves the
// scaled footprint (transform does not affect layout size); print CSS
// strips the toolbar/labels and resets the scale so output is 1:1.
import { useRef, type ReactNode } from 'react';
import type { CanonicalRecipe } from 'shared';
import { CARD_PAGE_HEIGHT_PX, CARD_PAGE_WIDTH_PX } from '../../lib/card-scale.ts';
import { useCardScale } from './useCardScale.ts';
import { CardPage1 } from './CardPage1.tsx';
import { CardPage2 } from './CardPage2.tsx';
import './card.css';

function PageFrame({ scale, label, children }: { scale: number; label: string; children: ReactNode }) {
  return (
    <div className="card-page-slot">
      <div
        className="card-page-frame"
        style={{ width: CARD_PAGE_WIDTH_PX * scale, height: CARD_PAGE_HEIGHT_PX * scale }}
      >
        <div className="card-page-scaler" style={{ transform: `scale(${scale})` }}>
          {children}
        </div>
      </div>
      <p className="card-page-label">{label}</p>
    </div>
  );
}

export function CardView({ recipe, onBack }: { recipe: CanonicalRecipe; onBack: () => void }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const { scale, sideBySide } = useCardScale(pagesRef);

  return (
    <div className="card-view">
      <div className="card-view-toolbar">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <button type="button" onClick={() => window.print()}>
          Print / Save PDF
        </button>
      </div>
      <div ref={pagesRef} className={sideBySide ? 'card-view-pages card-view-pages-row' : 'card-view-pages'}>
        <PageFrame scale={scale} label="Page 1">
          <CardPage1 recipe={recipe} />
        </PageFrame>
        <PageFrame scale={scale} label="Page 2">
          <CardPage2 recipe={recipe} />
        </PageFrame>
      </div>
    </div>
  );
}

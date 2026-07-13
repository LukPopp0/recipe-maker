// Local-state tab switcher for the three ingestion entry points.
import { useState } from 'react';
import type { CanonicalRecipe } from 'shared';
import type { IngestDiagnostics } from '../../api/client.ts';
import { LoadJsonTab } from './LoadJsonTab.tsx';
import { ManualTab } from './ManualTab.tsx';
import { UrlTab } from './UrlTab.tsx';

type IngestTab = 'url' | 'manual' | 'json';

const TABS: { id: IngestTab; label: string }[] = [
  { id: 'url', label: 'URL' },
  { id: 'manual', label: 'Manual' },
  { id: 'json', label: 'Load JSON' },
];

export function IngestTabs({
  onRecipe,
  onExtractStart,
}: {
  onRecipe: (recipe: CanonicalRecipe, diagnostics: IngestDiagnostics | null, imageNamespaceId?: string) => void
  onExtractStart: () => void
}) {
  const [activeTab, setActiveTab] = useState<IngestTab>('url');

  return (
    <div className="ingest-tabs">
      <div className="ingest-tabs-list" role="tablist" aria-label="Ingestion method">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="ingest-tabs-tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="ingest-tabs-panel" role="tabpanel">
        {activeTab === 'url' ? <UrlTab onRecipe={onRecipe} onExtractStart={onExtractStart} /> : null}
        {activeTab === 'manual' ? <ManualTab onRecipe={onRecipe} onExtractStart={onExtractStart} /> : null}
        {activeTab === 'json' ? <LoadJsonTab onRecipe={onRecipe} /> : null}
      </div>
    </div>
  );
}

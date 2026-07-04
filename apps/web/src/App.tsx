import { useCallback, useState } from 'react';
import type { CanonicalRecipe } from 'shared';
import type { IngestDiagnostics } from './api/client.ts';
import { shouldConfirmReplace, type WorkspaceRecipeState } from './workspace-types.ts';
import { IngestTabs } from './components/ingest/IngestTabs.tsx';
import { ReviewPanel } from './components/review/ReviewPanel.tsx';
import { JsonPanel } from './components/json/JsonPanel.tsx';
import { LibraryPanel } from './components/library/LibraryPanel.tsx';

// Nav is local-state only (plan decision 11) - no router yet.
type WorkspaceView = 'create' | 'library';

function statusLabel(state: WorkspaceRecipeState): string {
  if (!state) return 'Idle';
  if (state.savedId && !state.dirty) return 'Saved';
  if (state.dirty) return 'Unsaved changes';
  return 'Recipe loaded';
}

function App() {
  const [view, setView] = useState<WorkspaceView>('create');
  const [recipeState, setRecipeState] = useState<WorkspaceRecipeState>(null);

  // Replacing the loaded recipe (fresh ingestion or Load JSON) discards any
  // unsaved edits, so confirm first when the current state is dirty (plan
  // decision 12).
  const adoptRecipe = useCallback(
    (recipe: CanonicalRecipe, diagnostics: IngestDiagnostics | null): boolean => {
      if (shouldConfirmReplace(recipeState)) {
        const proceed = window.confirm(
          'Loading a new recipe will discard your unsaved changes. Continue?',
        );
        if (!proceed) return false;
      }
      setRecipeState({ recipe, diagnostics, savedId: null, dirty: false });
      return true;
    },
    [recipeState],
  );

  // Open in Create copies a saved recipe into the workspace (specs/13):
  // saving it again creates a new id, the library original is untouched.
  const handleOpenInCreate = useCallback(
    (recipe: CanonicalRecipe) => {
      if (adoptRecipe(recipe, null)) {
        setView('create');
      }
    },
    [adoptRecipe],
  );

  // Every review-panel edit produces a freshly patched recipe (single source
  // of truth in App); editing always marks the workspace dirty and clears
  // any prior save, since the saved copy no longer matches what's on screen.
  const handleRecipeChange = useCallback((recipe: CanonicalRecipe) => {
    setRecipeState((prev) => (prev ? { ...prev, recipe, dirty: true, savedId: null } : prev));
  }, []);

  // Only JsonPanel's explicit Save Recipe action calls this - it is the
  // single place that marks the workspace saved and clears dirty.
  const handleSaved = useCallback((id: string) => {
    setRecipeState((prev) => (prev ? { ...prev, savedId: id, dirty: false } : prev));
  }, []);

  const inCreate = view === 'create';

  return (
    <main id="workspace-shell" className="workspace-shell">
      <header className="workspace-header">
        <h1>Recipe Maker</h1>
        <span className="workspace-status">{statusLabel(recipeState)}</span>
      </header>

      <nav className="workspace-nav" aria-label="Primary">
        <button
          type="button"
          className="workspace-nav-item"
          aria-current={view === 'create' ? 'page' : undefined}
          onClick={() => setView('create')}
        >
          Create
        </button>
        <button
          type="button"
          className="workspace-nav-item"
          aria-current={view === 'library' ? 'page' : undefined}
          onClick={() => setView('library')}
        >
          Library
        </button>
      </nav>

      <section className="workspace-panel workspace-panel-input" aria-labelledby="input-panel-heading" hidden={!inCreate}>
        <h2 id="input-panel-heading">Input</h2>
        <IngestTabs onRecipe={adoptRecipe} />
      </section>

      <section className="workspace-panel workspace-panel-review" aria-labelledby="review-panel-heading" hidden={!inCreate}>
        <h2 id="review-panel-heading">Review</h2>
        {recipeState ? (
          <ReviewPanel
            recipe={recipeState.recipe}
            diagnostics={recipeState.diagnostics}
            onChange={handleRecipeChange}
          />
        ) : (
          <p>No recipe loaded yet. Ingest a recipe or load a JSON file to get started.</p>
        )}
      </section>

      <section className="workspace-panel workspace-panel-json" aria-labelledby="json-panel-heading" hidden={!inCreate}>
        <h2 id="json-panel-heading">JSON</h2>
        {recipeState ? (
          <JsonPanel
            recipe={recipeState.recipe}
            savedId={recipeState.savedId}
            dirty={recipeState.dirty}
            onSaved={handleSaved}
          />
        ) : (
          <p>Nothing to show yet - ingest or load a recipe first.</p>
        )}
      </section>

      {view === 'library' ? (
        <section className="workspace-panel workspace-panel-library" aria-labelledby="library-panel-heading">
          <h2 id="library-panel-heading">Library</h2>
          <LibraryPanel onOpenInCreate={handleOpenInCreate} />
        </section>
      ) : null}
    </main>
  );
}

export default App;

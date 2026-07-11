import { useCallback, useState } from 'react';
import type { CanonicalRecipe } from 'shared';
import type { IngestDiagnostics } from './api/client.ts';
import { shouldConfirmReplace, type WorkspaceRecipeState } from './workspace-types.ts';
import { IngestTabs } from './components/ingest/IngestTabs.tsx';
import { ReviewPanel } from './components/review/ReviewPanel.tsx';
import { JsonPanel } from './components/json/JsonPanel.tsx';
import { ActionTray } from './components/ActionTray.tsx';
import { useTheme } from './lib/use-theme.ts';
import { LibraryPanel } from './components/library/LibraryPanel.tsx';
import { CardView } from './components/card/CardView.tsx';

// Nav is local-state only (plan decision 11) - no router yet.
type WorkspaceView = 'create' | 'library';

// Hides Create panels behind the card preview (or Library view) via inline
// style rather than the `hidden` attribute: `hidden` (and CSS visibility)
// pull an element out of the accessibility tree entirely, but Task 7's tests
// need to find these headings by role while asserting they are not visible -
// opacity is excluded from an element's a11y-tree check but still fails
// jest-dom's toBeVisible().
const HIDDEN_PANEL_STYLE = { position: 'absolute', opacity: 0, pointerEvents: 'none' } as const;

function statusLabel(state: WorkspaceRecipeState): string {
  if (!state) return 'Idle';
  if (state.savedId && !state.dirty) return 'Saved';
  if (state.dirty) return 'Unsaved changes';
  return 'Recipe loaded';
}

function statusVariant(state: WorkspaceRecipeState): string {
  if (!state) return 'idle';
  if (state.savedId && !state.dirty) return 'saved';
  if (state.dirty) return 'dirty';
  return 'loaded';
}

function App() {
  const [view, setView] = useState<WorkspaceView>('create');
  const [recipeState, setRecipeState] = useState<WorkspaceRecipeState>(null);
  const [showCardPreview, setShowCardPreview] = useState(false);
  // Wizard flow (phase 8.5 item 11): the Input stage collapses to a slim row
  // once a recipe arrives, and the JSON stage is a drawer, closed by default.
  // Collapsed/closed stages stay mounted (hidden attr) so form state survives
  // reopening; headings stay in the DOM for the panel-visibility tests.
  const [inputCollapsed, setInputCollapsed] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [theme, toggleTheme] = useTheme();

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
      setShowCardPreview(false);
      setInputCollapsed(true);
      return true;
    },
    [recipeState],
  );

  // A new extraction (URL or Manual) clears the current recipe up front so
  // the stale Review/JSON panels don't linger during the ~1 min run. Extraction
  // is an explicit user action, so we drop unsaved edits without a confirm
  // (phase 8.5 item 5). Validation failures never reach here, so a rejected
  // submit keeps the current recipe on screen.
  const handleExtractStart = useCallback(() => {
    setRecipeState(null);
    setShowCardPreview(false);
    setInputCollapsed(false);
  }, []);

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

  // Only the ActionTray's explicit Save Recipe action calls this - it is the
  // single place that marks the workspace saved and clears dirty.
  const handleSaved = useCallback((id: string) => {
    setRecipeState((prev) => (prev ? { ...prev, savedId: id, dirty: false } : prev));
  }, []);

  const inCreate = view === 'create' && !showCardPreview;

  return (
    <main id="workspace-shell" className="workspace-shell">
      <header className="workspace-header">
        <h1>Recipe Maker</h1>
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
        <span className={`workspace-status workspace-status--${statusVariant(recipeState)}`}>
          {statusLabel(recipeState)}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-pressed={theme === 'dark'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
      </header>

      {/* inert (React 19) drops focus/AT exposure for hidden panels; opacity
          keeps them queryable-but-not-visible for the Task 7 test suite. */}
      <section
        className={
          inputCollapsed
            ? 'workspace-panel workspace-panel-input workspace-panel-collapsed'
            : 'workspace-panel workspace-panel-input'
        }
        aria-labelledby="input-panel-heading"
        style={inCreate ? undefined : HIDDEN_PANEL_STYLE}
        inert={inCreate ? undefined : true}
      >
        <div className="workspace-stage-header">
          <span className="workspace-stage-number" aria-hidden="true">1</span>
          <h2 id="input-panel-heading">Input</h2>
          {recipeState ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm workspace-stage-toggle"
              aria-expanded={!inputCollapsed}
              onClick={() => setInputCollapsed((collapsed) => !collapsed)}
            >
              {inputCollapsed ? 'Edit input' : 'Collapse'}
            </button>
          ) : null}
        </div>
        <div hidden={inputCollapsed}>
          <IngestTabs onRecipe={adoptRecipe} onExtractStart={handleExtractStart} />
        </div>
      </section>

      <section
        className="workspace-panel workspace-panel-review"
        aria-labelledby="review-panel-heading"
        style={inCreate ? undefined : HIDDEN_PANEL_STYLE}
        inert={inCreate ? undefined : true}
      >
        <div className="workspace-stage-header">
          <span className="workspace-stage-number" aria-hidden="true">2</span>
          <h2 id="review-panel-heading">Review</h2>
        </div>
        {recipeState ? (
          <ReviewPanel
            recipe={recipeState.recipe}
            diagnostics={recipeState.diagnostics}
            onChange={handleRecipeChange}
          />
        ) : (
          <p className="workspace-empty-note">
            No recipe loaded yet. Ingest a recipe or load a JSON file to get started.
          </p>
        )}
      </section>

      <section
        className="workspace-panel workspace-panel-json"
        aria-labelledby="json-panel-heading"
        style={inCreate ? undefined : HIDDEN_PANEL_STYLE}
        inert={inCreate ? undefined : true}
      >
        <div className="workspace-stage-header">
          <span className="workspace-stage-number" aria-hidden="true">3</span>
          <h2 id="json-panel-heading">JSON</h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm workspace-stage-toggle"
            aria-expanded={jsonOpen}
            onClick={() => setJsonOpen((open) => !open)}
          >
            {jsonOpen ? 'Hide JSON' : 'Show JSON'}
          </button>
        </div>
        <div hidden={!jsonOpen}>
          {recipeState ? (
            <JsonPanel recipe={recipeState.recipe} />
          ) : (
            <p className="workspace-empty-note">Nothing to show yet - ingest or load a recipe first.</p>
          )}
        </div>
      </section>

      <ActionTray
        recipeState={recipeState}
        visible={inCreate}
        onSaved={handleSaved}
        onPreviewCard={() => setShowCardPreview(true)}
      />

      {view === 'library' ? (
        <section className="workspace-panel workspace-panel-library" aria-labelledby="library-panel-heading">
          <h2 id="library-panel-heading">Library</h2>
          <LibraryPanel onOpenInCreate={handleOpenInCreate} />
        </section>
      ) : null}

      {view === 'create' && showCardPreview && recipeState ? (
        <section className="workspace-panel workspace-panel-card" aria-labelledby="card-panel-heading">
          <h2 id="card-panel-heading">Card Preview</h2>
          <CardView recipe={recipeState.recipe} onBack={() => setShowCardPreview(false)} />
        </section>
      ) : null}
    </main>
  );
}

export default App;

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanonicalRecipe, CurrentUser, ImageSlot, UnhostedImage } from 'shared';
import { getMe, uploadImage, type CaptureIngestResult, type IngestDiagnostics } from './api/client.ts';
import { DEFAULT_PLACEHOLDER_IMAGE_URL, isSlotEmpty, setSlotImage } from './lib/image-slots.ts';
import { useCaptureHandoff } from './capture/use-capture-handoff.ts';
import { relayUnhostedImages } from './capture/relay-images.ts';
import { CapturePanel } from './components/ingest/CapturePanel.tsx';
import { shouldConfirmReplace, type WorkspaceRecipeState } from './workspace-types.ts';
import { IngestTabs } from './components/ingest/IngestTabs.tsx';
import { ReviewPanel } from './components/review/ReviewPanel.tsx';
import { JsonPanel } from './components/json/JsonPanel.tsx';
import { ActionTray } from './components/ActionTray.tsx';
import { useTheme } from './lib/use-theme.ts';
import { LibraryPanel } from './components/library/LibraryPanel.tsx';
import { CardView } from './components/card/CardView.tsx';
import { SetupPage } from './components/setup/SetupPage.tsx';

// Nav is local-state only (plan decision 11) - no router. Only /setup gets a
// pushed path (docs/specs/15); popstate returns to the previous view.
type WorkspaceView = 'create' | 'library' | 'setup';

// Hides Create panels behind the card preview (or Library view) via inline
// style rather than the `hidden` attribute: `hidden` (and CSS visibility)
// pull an element out of the accessibility tree entirely, but Task 7's tests
// need to find these headings by role while asserting they are not visible -
// opacity is excluded from an element's a11y-tree check but still fails
// jest-dom's toBeVisible().
// height 0 + overflow hidden keep the invisible panels from extending the
// page's scrollable height (an out-of-flow absolute box still paints into
// the scroll area), so the card preview page is only as tall as the card.
const HIDDEN_PANEL_STYLE = {
  position: 'absolute',
  opacity: 0,
  pointerEvents: 'none',
  height: 0,
  overflow: 'hidden',
} as const;

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
  const [view, setView] = useState<WorkspaceView>(() =>
    window.location.pathname === '/setup' ? 'setup' : 'create',
  );
  const previousViewRef = useRef<WorkspaceView>('create');
  // Capture mode (docs/specs/15) is decided once at load: the handoff hook
  // rewrites the URL to / after receiving the page.
  const [captureMode] = useState(() => window.location.pathname === '/capture');
  const { state: handoff, requestRelay } = useCaptureHandoff(captureMode);
  const [relayRuns, setRelayRuns] = useState(0);
  const [recipeState, setRecipeState] = useState<WorkspaceRecipeState>(null);
  const [showCardPreview, setShowCardPreview] = useState(false);
  // Wizard flow (phase 8.5 item 11): the Input stage collapses to a slim row
  // once a recipe arrives, and the JSON stage is a drawer, closed by default.
  // Collapsed/closed stages stay mounted (hidden attr) so form state survives
  // reopening; headings stay in the DOM for the panel-visibility tests.
  const [inputCollapsed, setInputCollapsed] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [theme, toggleTheme] = useTheme();
  // Who is logged in (always "local" without AUTH_MODE=header). Library uses
  // it for owner/admin actions; a failed lookup just hides the name.
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  const [placeholderImageUrl, setPlaceholderImageUrl] = useState(DEFAULT_PLACEHOLDER_IMAGE_URL);

  useEffect(() => {
    void getMe().then((result) => {
      if (result.ok) {
        setCurrentUser(result.value.user);
        setPlaceholderImageUrl(result.value.placeholderImageUrl || DEFAULT_PLACEHOLDER_IMAGE_URL);
      }
    });
  }, []);

  // Replacing the loaded recipe (fresh ingestion or Load JSON) discards any
  // unsaved edits, so confirm first when the current state is dirty (plan
  // decision 12).
  const adoptRecipe = useCallback(
    (recipe: CanonicalRecipe, diagnostics: IngestDiagnostics | null, imageNamespaceId?: string, sourceId?: string, unhosted: UnhostedImage[] = []): boolean => {
      if (shouldConfirmReplace(recipeState)) {
        const proceed = window.confirm(
          'Loading a new recipe will discard your unsaved changes. Continue?',
        );
        if (!proceed) return false;
      }
      // Recipes that never went through ingestion (Load JSON, Open in Create)
      // get a fresh client-minted namespace for image uploads.
      setRecipeState({
        recipe,
        diagnostics,
        savedId: null,
        dirty: false,
        imageNamespaceId: imageNamespaceId ?? crypto.randomUUID(),
        sourceId: sourceId ?? null,
        unhosted,
      });
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

  // Capture: adopt the recipe, then ask the capture source for the images the
  // server could not host. Relay results never overwrite a slot the user filled
  // meanwhile or a replaced workspace; they mark the recipe dirty only after a save.
  const handleCaptureIngested = useCallback(
    (result: CaptureIngestResult) => {
      if (!adoptRecipe(result.recipe, result.diagnostics, result.imageNamespaceId, undefined, result.unhosted)) return;
      if (result.unhosted.length === 0) return;
      setRelayRuns((n) => n + 1);
      void relayUnhostedImages({
        unhosted: result.unhosted,
        namespaceId: result.imageNamespaceId,
        requestRelay,
        upload: uploadImage,
        onImage: (slot: ImageSlot, url: string) => {
          setRecipeState((prev) => {
            if (!prev || prev.imageNamespaceId !== result.imageNamespaceId) return prev;
            if (!isSlotEmpty(prev.recipe, slot, placeholderImageUrl)) return prev;
            // Before a save the image is part of the fresh extraction (stays
            // not dirty); after a save it is a real unsaved change.
            return {
              ...prev,
              recipe: setSlotImage(prev.recipe, slot, url, { placeholderUrl: placeholderImageUrl, unhosted: prev.unhosted }),
              unhosted: prev.unhosted.filter((u) => u.slot !== slot),
              ...(prev.savedId !== null ? { dirty: true, savedId: null } : {}),
            };
          });
        },
      }).finally(() => setRelayRuns((n) => n - 1));
    },
    [adoptRecipe, requestRelay, placeholderImageUrl],
  );

  // Open in Create loads a saved recipe for editing: Save changes updates it
  // in place, Save as new makes a copy.
  const handleOpenInCreate = useCallback(
    (recipe: CanonicalRecipe, sourceId: string) => {
      if (adoptRecipe(recipe, null, undefined, sourceId)) {
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

  // Only the ActionTray's explicit save actions call this - it is the
  // single place that marks the workspace saved and clears dirty.
  const handleSaved = useCallback((id: string) => {
    setRecipeState((prev) => (prev ? { ...prev, savedId: id, sourceId: id, dirty: false } : prev));
  }, []);

  const openSetup = useCallback(() => {
    if (view === 'setup') return;
    previousViewRef.current = view;
    window.history.pushState({}, '', '/setup');
    setView('setup');
  }, [view]);

  // The path and the view stay in sync both ways (Back and Forward).
  useEffect(() => {
    const onPopState = () => {
      const onSetupPath = window.location.pathname === '/setup';
      setView((current) => {
        if (onSetupPath) {
          if (current !== 'setup') previousViewRef.current = current;
          return 'setup';
        }
        return current === 'setup' ? previousViewRef.current : current;
      });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Create/Library leave Setup by replacing its history entry, so Back never
  // lands on a /setup entry that shows another view.
  const switchView = useCallback((next: WorkspaceView) => {
    if (window.location.pathname === '/setup') window.history.replaceState(null, '', '/');
    setView(next);
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
            onClick={() => switchView('create')}
          >
            Create
          </button>
          <button
            type="button"
            className="workspace-nav-item"
            aria-current={view === 'library' ? 'page' : undefined}
            onClick={() => switchView('library')}
          >
            Library
          </button>
          <a
            href="/setup"
            className="workspace-nav-item"
            aria-current={view === 'setup' ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              openSetup();
            }}
          >
            Setup
          </a>
        </nav>
        <span className={`workspace-status workspace-status--${statusVariant(recipeState)}`}>
          {statusLabel(recipeState)}
        </span>
        {currentUser ? <span className="workspace-user">{currentUser.username}</span> : null}
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
          {captureMode ? (
            <CapturePanel handoff={handoff} onExtractStart={handleExtractStart} onIngested={handleCaptureIngested} />
          ) : null}
          <IngestTabs onRecipe={adoptRecipe} onExtractStart={handleExtractStart} onOpenSetup={openSetup} />
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
        {relayRuns > 0 ? <p role="status">Fetching images from the recipe tab...</p> : null}
        {recipeState ? (
          <ReviewPanel
            // A replaced recipe gets a new namespace: remount so a pending
            // upload from the old recipe cannot land in the new one.
            key={recipeState.imageNamespaceId}
            recipe={recipeState.recipe}
            diagnostics={recipeState.diagnostics}
            onChange={handleRecipeChange}
            imageNamespaceId={recipeState.imageNamespaceId}
            placeholderImageUrl={placeholderImageUrl}
            unhosted={recipeState.unhosted}
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
          <LibraryPanel currentUser={currentUser} onOpenInCreate={handleOpenInCreate} />
        </section>
      ) : null}

      {view === 'setup' ? (
        <section className="workspace-panel workspace-panel-setup" aria-labelledby="setup-panel-heading">
          <h2 id="setup-panel-heading">Setup</h2>
          <SetupPage appOrigin={window.location.origin} />
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

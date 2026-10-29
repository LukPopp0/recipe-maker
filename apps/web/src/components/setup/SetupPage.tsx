// Setup page (docs/specs/15): explains and offers the "Send to Recipe Maker"
// bookmarklet and the browser extension.
import { useEffect, useRef, useState } from 'react';
import { buildBookmarklet } from '../../lib/bookmarklet.ts';

const RELEASE_BASE = 'https://github.com/LukPopp0/recipe-maker/releases/latest/download';
const XPI_URL = `${RELEASE_BASE}/recipe-maker.xpi`;
const CHROME_ZIP_URL = `${RELEASE_BASE}/recipe-maker-chrome.zip`;

export function SetupPage({ appOrigin }: { appOrigin: string }) {
  const bookmarklet = buildBookmarklet(appOrigin);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => {
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
  }, []);

  useEffect(() => {
    if (copyFailed) {
      fallbackRef.current?.focus();
      fallbackRef.current?.select();
    }
  }, [copyFailed]);

  // React 19 blocks javascript: hrefs, so set it on the DOM node directly.
  useEffect(() => {
    linkRef.current?.setAttribute('href', bookmarklet);
  }, [bookmarklet]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bookmarklet);
    } catch {
      setCopied(false);
      setCopyFailed(true);
      return;
    }
    setCopyFailed(false);
    setCopied(true);
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="setup-page">
      <section aria-labelledby="setup-why">
        <h3 id="setup-why">Why this exists</h3>
        <p>
          Many recipe sites block servers, so Recipe Maker cannot fetch them itself. Your browser can see the page,
          so these tools let your browser send it to Recipe Maker instead. Use the bookmarklet or an extension on
          the recipe page, then review and save as usual.
        </p>
        <p>
          Your Recipe Maker address: <code className="setup-origin">{appOrigin}</code>
        </p>
      </section>

      <section aria-labelledby="setup-bookmarklet">
        <h3 id="setup-bookmarklet">Bookmarklet (desktop)</h3>
        <p>
          Drag this link to your bookmarks bar: <a ref={linkRef} href="#setup-bookmarklet" className="setup-bookmarklet" onClick={(e) => e.preventDefault()}>Send to Recipe Maker</a>
        </p>
        <p>Then open a recipe page and click the bookmark. It works in Firefox and Chrome on desktop.</p>
        <p>
          The bookmarklet does not work in Firefox on Android (Firefox blocks the new tab it opens). Use the
          Firefox extension below there.
        </p>
      </section>

      <section aria-labelledby="setup-chrome-android">
        <h3 id="setup-chrome-android">Bookmarklet (Chrome on Android)</h3>
        <ol>
          <li>
            <button type="button" className="btn btn-sm" onClick={() => void copy()}>
              Copy bookmarklet code
            </button>{' '}
            {copied ? <span role="status">Copied</span> : null}
            {copyFailed ? (
              <>
                <span role="status">Could not copy. Select the code below and copy it.</span>
                <textarea
                  ref={fallbackRef}
                  className="setup-code-fallback"
                  aria-label="Bookmarklet code"
                  readOnly
                  rows={4}
                  value={bookmarklet}
                />
              </>
            ) : null}
          </li>
          <li>Create any bookmark in Chrome, then edit it.</li>
          <li>Paste the code as the URL and give it a short name such as "rm".</li>
          <li>
            Chrome may strip the start when pasting: check that the saved URL still starts with javascript:
          </li>
          <li>
            On the recipe page, type the name in the address bar and tap the javascript: suggestion.
          </li>
        </ol>
        <p>Tip: a bookmarklet created in Chrome on desktop syncs to Chrome on Android with bookmark sync.</p>
      </section>

      <section aria-labelledby="setup-firefox">
        <h3 id="setup-firefox">Firefox extension (desktop and Android)</h3>
        <p>
          <a href={XPI_URL}>Download recipe-maker.xpi</a>
        </p>
        <h4>Desktop</h4>
        <ol>
          <li>Open the downloaded .xpi file in Firefox and confirm the install.</li>
          <li>Firefox asks to grant access to all sites; the extension needs it to read the recipe page.</li>
          <li>Open the extension options and enter the Recipe Maker address shown above.</li>
        </ol>
        <h4>Android</h4>
        <ol>
          <li>Download the .xpi file.</li>
          <li>In Firefox open Settings, then About Firefox, and tap the Firefox logo 5 times to enable the debug menu.</li>
          <li>Go back to Settings and choose "Install add-on from file", then pick the downloaded .xpi.</li>
          <li>Firefox asks to grant access to all sites; allow it.</li>
          <li>Open the extension options and enter the Recipe Maker address shown above.</li>
        </ol>
        <p>
          Pasting images is unreliable in Firefox on Android. When you add manual images there, use Link or Upload.
        </p>
      </section>

      <section aria-labelledby="setup-chrome">
        <h3 id="setup-chrome">Chrome extension (desktop)</h3>
        <p>
          <a href={CHROME_ZIP_URL}>Download recipe-maker-chrome.zip</a>
        </p>
        <ol>
          <li>Extract the zip into a folder.</li>
          <li>Open chrome://extensions and enable Developer mode.</li>
          <li>Click "Load unpacked" and choose the folder.</li>
          <li>Open the extension options and enter the Recipe Maker address shown above.</li>
        </ol>
        <p>Chrome shows a developer-mode warning on startup. That is expected. The bookmarklet also works in Chrome on desktop.</p>
      </section>
    </div>
  );
}

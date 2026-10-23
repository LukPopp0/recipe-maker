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

  // React 19 blocks javascript: hrefs, so set it on the DOM node directly.
  useEffect(() => {
    linkRef.current?.setAttribute('href', bookmarklet);
  }, [bookmarklet]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bookmarklet);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="setup-page">
      <section aria-labelledby="setup-why">
        <h2 id="setup-why">Why this exists</h2>
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
        <h2 id="setup-bookmarklet">Bookmarklet (desktop)</h2>
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
        <h2 id="setup-chrome-android">Bookmarklet (Chrome on Android)</h2>
        <ol>
          <li>
            <button type="button" className="btn btn-sm" onClick={() => void copy()}>
              Copy bookmarklet code
            </button>{' '}
            {copied ? <span role="status">Copied</span> : null}
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
        <h2 id="setup-firefox">Firefox extension (desktop and Android)</h2>
        <p>
          <a href={XPI_URL}>Download recipe-maker.xpi</a>
        </p>
        <h3>Desktop</h3>
        <ol>
          <li>Open the downloaded .xpi file in Firefox and confirm the install.</li>
          <li>Firefox asks to grant access to all sites; the extension needs it to read the recipe page.</li>
          <li>Open the extension options and enter the Recipe Maker address shown above.</li>
        </ol>
        <h3>Android</h3>
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
        <h2 id="setup-chrome">Chrome extension (desktop)</h2>
        <p>
          <a href={CHROME_ZIP_URL}>Download recipe-maker-chrome.zip</a>
        </p>
        <ol>
          <li>Extract the zip into a folder.</li>
          <li>Open chrome://extensions and enable Developer mode.</li>
          <li>Click "Load unpacked" and choose the folder.</li>
          <li>Open the extension options and enter the Recipe Maker address shown above.</li>
        </ol>
        <p>Chrome shows a developer-mode warning on startup; the developer-mode warning is expected. The bookmarklet also works in Chrome on desktop.</p>
      </section>
    </div>
  );
}

import { BOOKMARKLET_SOURCE } from '../generated/bookmarklet-source';

const ORIGIN_TOKEN = '__RECIPE_MAKER_ORIGIN__';

/** Build the `javascript:` URL for the capture bookmarklet, targeting `appOrigin`. */
export function buildBookmarklet(appOrigin: string): string {
  let origin: string;
  try {
    origin = new URL(appOrigin).origin;
  } catch {
    throw new Error(`Invalid app origin: ${appOrigin}`);
  }
  if (origin !== appOrigin) throw new Error(`App origin must not include a path: ${appOrigin}`);
  return 'javascript:' + encodeURIComponent(BOOKMARKLET_SOURCE.replace(ORIGIN_TOKEN, () => origin));
}

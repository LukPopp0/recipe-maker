import { getExtensionApi } from './api';

const api = getExtensionApi();
const input = document.getElementById('address') as HTMLInputElement;
const saveButton = document.getElementById('save') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLElement;

function parseOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

async function save(): Promise<void> {
  const origin = parseOrigin(input.value);
  if (!origin) {
    status.textContent = 'Enter a valid address, for example https://recipes.example';
    return;
  }
  try {
    // Started first, synchronously in the click handler, so it still counts as a user gesture.
    const granted = api.permissions.request({ origins: ['<all_urls>'] });
    await api.storage.local.set({ appOrigin: origin });
    input.value = origin;
    status.textContent = (await granted)
      ? `Saved ${origin}.`
      : `Saved ${origin}, but access to all websites was not allowed. Press Save again and allow it.`;
  } catch (error) {
    status.textContent = `Could not save: ${error instanceof Error ? error.message : String(error)}`;
  }
}

saveButton.addEventListener('click', () => void save());
api.storage.local
  .get('appOrigin')
  .then(({ appOrigin }) => {
    if (typeof appOrigin === 'string') input.value = appOrigin;
  })
  .catch((error) => console.error('Could not read the saved address', error));

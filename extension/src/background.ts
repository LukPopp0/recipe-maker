import { getExtensionApi } from './api';

const api = getExtensionApi();

api.action.onClicked.addListener(async (tab) => {
  await api.tabs.create({ url: 'https://example.com/' });
  if (tab.id === undefined) return;
  const results = await api.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => document.title,
  });
  console.log('page title:', results[0]?.result);
});

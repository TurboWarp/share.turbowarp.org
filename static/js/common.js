// Helpers shared by all pages. Plain script, no modules or build step.

window.fetchWithErrorHandling = async (input, init) => {
  const response = await fetch(input, init);
  if (!response.ok) {
    // Try to parse an extract error message from the response
    let error = 'unknown';
    try {
      const json = await response.json();
      if (json && typeof json.message === 'string') {
        error = json.message;
      }
    } catch (e) {
      // ignore
    }
    throw new Error(`HTTP status ${response.status} fetching ${response.url}: ${error}`);
  }
  return response;
};

(() => {
  // Don't change this key, otherwise people lose access to projects they've already uploaded.
  const DATA_KEY = 'unshared:localProjectData0';

  const getLocalProjectData = () => {
    try {
      const stored = localStorage.getItem(DATA_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      // ignore
    }
    return {};
  };

  window.getOwnershipToken = (projectId) => {
    const localData = getLocalProjectData()[projectId];
    return localData ? localData.ownershipToken : null;
  };

  window.storeLocalProjectData = (projectId, ownershipToken) => {
    const tokens = getLocalProjectData();
    tokens[projectId] = {
      ownershipToken
    };
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify(tokens));
    } catch (e) {
      // ignore
    }
  };
})();

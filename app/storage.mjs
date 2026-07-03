export function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

export function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`Could not persist ${key}.`, error);
    return false;
  }
}

export function removeStored(key) {
  localStorage.removeItem(key);
}

const KEY = 'cricket-polls.admin';

/**
 * The admin password is held in sessionStorage: it survives a page reload
 * during a match but is gone when the tab closes, which is the right trade-off
 * for a phone that gets passed around a commentary box.
 */
export const readAdminPassword = () => {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export const storeAdminPassword = (password) => {
  try {
    window.sessionStorage.setItem(KEY, password);
  } catch {
    /* held in React state for this page load only */
  }
};

export const clearAdminPassword = () => {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
};

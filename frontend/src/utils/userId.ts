// User ID management
export const getUserId = (): string => {
  let userId = localStorage.getItem("dex_user_id");
  if (!userId) {
    userId = crypto.randomUUID();
    localStorage.setItem("dex_user_id", userId);
  }
  return userId;
};

export const clearUserId = (): void => {
  localStorage.removeItem("dex_user_id");
};

export function createBookQuotesStore() {
  return {
    searchValue: "",
    isSaving: false,
    feedbackMessage: "",
    feedbackTone: "",
    draft: createEmptyBookQuoteDraft(),
  };
}

export function createEmptyBookQuoteDraft() {
  return {
    text: "",
    page: "",
    note: "",
  };
}

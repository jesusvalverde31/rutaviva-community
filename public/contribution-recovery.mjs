export function pendingMatches(pending, contributionId) {
  return Boolean(pending && pending.id === contributionId);
}

export function recoveryDecision(status) {
  if (['submitted', 'under_review', 'published'].includes(status)) return 'complete';
  if (status === 'draft') return 'retry';
  if (['withdrawn', 'rejected'].includes(status)) return 'discard';
  return 'unknown';
}

export function correctionConfirmation(current: string | null, proposed: string | null) {
  if (!current) return { allowed: false, message: 'Current settlement is unavailable. Reload before correcting.' };
  if (!proposed) return { allowed: false, message: 'Choose a proposed result.' };
  if (current.toLowerCase() === proposed.toLowerCase()) return { allowed: false, message: 'Choose a result different from the current result.' };
  return { allowed: true, message: `Current: ${current} → Proposed: ${proposed}` };
}

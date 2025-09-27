function fallbackUuid() {
  let timestamp = Date.now();
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    timestamp += performance.now();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (timestamp + Math.random() * 16) % 16 | 0;
    timestamp = Math.floor(timestamp / 16);
    if (char === 'x') {
      return random.toString(16);
    }
    return ((random & 0x3) | 0x8).toString(16);
  });
}

export function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return fallbackUuid();
}

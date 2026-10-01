import { useEffect, useState } from 'react';

// A value that follows another after a pause, so a search box doesn't query on every key.
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

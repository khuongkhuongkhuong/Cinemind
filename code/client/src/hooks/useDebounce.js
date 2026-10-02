import { useEffect, useState } from 'react';

/** Trả về `value` sau khi nó đứng yên `delay` ms — để ô tìm kiếm không gọi API ở MỖI phím gõ. */
export function useDebounce(value, delay = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

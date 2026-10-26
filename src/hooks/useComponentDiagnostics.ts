import { useEffect } from 'react';
import { trackMount, trackRender, trackUnmount } from '../services/memoryDiagnostics';

/**
 * Counts a component's lifetime and render churn without causing any state
 * updates. Only the diagnostics ring buffer is touched.
 */
export function useComponentDiagnostics(name: string): void {
  useEffect(() => {
    trackMount(name);
    return () => trackUnmount(name);
  }, [name]);

  useEffect(() => {
    trackRender(name);
  });
}

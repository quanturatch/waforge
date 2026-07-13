import { useEffect } from 'react';

/**
 * Custom hook to set document title dynamically.
 * Automatically appends " | WaForge" suffix.
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} | WaForge`;

    return () => {
      document.title = previousTitle;
    };
  }, [title]);
}

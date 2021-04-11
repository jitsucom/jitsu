import { useCallback, useState } from 'react';

export function useForceUpdate() {
  const [, updateState] = useState<object>();

  return useCallback(() => updateState({}), []);
}

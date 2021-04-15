import { useCallback, useState } from 'react';
import ApplicationServices from '../lib/services/ApplicationServices';

export function useServices(): ApplicationServices {
  return ApplicationServices.get();
}

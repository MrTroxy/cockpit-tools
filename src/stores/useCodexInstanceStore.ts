import * as codexInstanceService from '../services/codexInstanceService';
import { createInstanceStore } from './createInstanceStore';

export const useCodexInstanceStore = createInstanceStore(
  codexInstanceService,
  'cockpit.codex.instances.cache',
  ['agtools.codex.instances.cache']
);

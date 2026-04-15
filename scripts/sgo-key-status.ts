import { loadEnvironment } from '@unit-talk/config';
import {
  collectConfiguredSgoApiKeyCandidates,
  resolveActiveSgoApiKey,
} from '../apps/ingestor/src/sgo-key-manager.js';

async function main() {
  const env = loadEnvironment();
  const candidates = collectConfiguredSgoApiKeyCandidates(env);
  const selection = await resolveActiveSgoApiKey(candidates);

  console.log(
    JSON.stringify(
      {
        service: 'ingestor.sgo-key-status',
        configuredKeys: candidates.map((candidate) => ({
          source: candidate.source,
          tag: candidate.tag,
        })),
        activeKey: selection.active
          ? {
              source: selection.active.source,
              tag: selection.active.tag,
            }
          : null,
        probes: selection.probes,
      },
      null,
      2,
    ),
  );

  if (!selection.active) {
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify(
      {
        service: 'ingestor.sgo-key-status',
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});

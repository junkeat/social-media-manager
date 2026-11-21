import { formatUnexpectedError } from '../services/metaError';
import {
  PLATFORM_LABELS,
  type Platform,
  type PlatformResult,
  type PlatformService,
  type PublishRequest,
} from '../types/post';

export class PublishOrchestrator {
  constructor(private readonly services: Record<Platform, PlatformService>) {}

  async publish({ platforms, ...input }: PublishRequest): Promise<PlatformResult[]> {
    // allSettled runs every platform to the end, so one failure never stops the others.
    const outcomes = await Promise.allSettled(
      platforms.map((platform) => this.services[platform].publish(input))
    );

    return outcomes.map((outcome, i) => {
      if (outcome.status === 'fulfilled') return outcome.value;

      const platform = platforms[i];
      const error = formatUnexpectedError(outcome.reason, PLATFORM_LABELS[platform], []);
      return { platform, success: false, error };
    });
  }
}

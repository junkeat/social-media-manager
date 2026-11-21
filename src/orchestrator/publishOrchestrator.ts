import { formatUnexpectedError } from '../services/metaError';
import type {
  Platform,
  PlatformResult,
  PlatformService,
  PublishInput,
  PublishRequest,
} from '../types/post';

export class PublishOrchestrator {
  constructor(private readonly services: Record<Platform, PlatformService>) {}

  async publish(request: PublishRequest): Promise<PlatformResult[]> {
    const input: PublishInput = {
      text: request.text,
      imagePath: request.imagePath,
      imageUrl: request.imageUrl,
      imageMimeType: request.imageMimeType,
    };

    // Run selected platforms concurrently; Promise.allSettled isolates failures per platform.
    const outcomes = await Promise.allSettled(
      request.platforms.map((platform) => this.services[platform].publish(input))
    );

    return outcomes.map((outcome, index) => {
      const platform = request.platforms[index];
      if (outcome.status === 'fulfilled') {
        return outcome.value;
      }

      return {
        platform,
        success: false,
        error: formatUnexpectedError(outcome.reason, platform, []),
      };
    });
  }
}

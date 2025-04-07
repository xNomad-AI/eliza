import { IsString, IsOptional } from 'class-validator';
import { TwitterConfig as ExternalTwitterConfig, ActionTimelineType } from '@elizaos/client-twitter';
import { ApiExtraModels, ApiPropertyOptional } from '@nestjs/swagger';

@ApiExtraModels()
export class TwitterConfig implements ExternalTwitterConfig {
  @ApiPropertyOptional({
    description: 'Optional flag for dry run mode',
    example: true
  })
  @IsOptional()
  TWITTER_DRY_RUN?: boolean;

  @ApiPropertyOptional({
    description: 'Twitter username',
    example: 'user123'
  })
  @IsOptional()
  @IsString()
  TWITTER_USERNAME?: string;

  @ApiPropertyOptional({
    description: 'Twitter password',
    example: 'password123'
  })
  @IsOptional()
  @IsString()
  TWITTER_PASSWORD?: string;

  @ApiPropertyOptional({
    description: 'Twitter email',
    example: 'user@example.com'
  })
  @IsOptional()
  @IsString()
  TWITTER_EMAIL?: string;

  @ApiPropertyOptional({
    description: 'Maximum tweet length',
    example: 280
  })
  @IsOptional()
  MAX_TWEET_LENGTH?: number;

  @ApiPropertyOptional({
    description: 'Enable Twitter search',
    example: true
  })
  @IsOptional()
  TWITTER_SEARCH_ENABLE?: boolean;

  @ApiPropertyOptional({
    description: 'Twitter 2FA secret',
    example: '2FASecret123'
  })
  @IsOptional()
  @IsString()
  TWITTER_2FA_SECRET?: string;

  @ApiPropertyOptional({
    description: 'Retry limit for Twitter actions',
    example: 3
  })
  @IsOptional()
  TWITTER_RETRY_LIMIT?: number;

  @ApiPropertyOptional({
    description: 'Polling interval for Twitter actions in milliseconds',
    example: 5000
  })
  @IsOptional()
  TWITTER_POLL_INTERVAL?: number;

  @ApiPropertyOptional({
    description: 'Target users for Twitter actions',
    example: ['user1', 'user2']
  })
  @IsOptional()
  TWITTER_TARGET_USERS?: string[];

  @ApiPropertyOptional({
    description: 'Enable Twitter post generation',
    example: true
  })
  @IsOptional()
  ENABLE_TWITTER_POST_GENERATION?: boolean;

  @ApiPropertyOptional({
    description: 'Minimum interval between posts in seconds',
    example: 60
  })
  @IsOptional()
  POST_INTERVAL_MIN?: number;

  @ApiPropertyOptional({
    description: 'Maximum interval between posts in seconds',
    example: 300
  })
  @IsOptional()
  POST_INTERVAL_MAX?: number;

  @ApiPropertyOptional({
    description: 'Enable action processing',
    example: true
  })
  @IsOptional()
  ENABLE_ACTION_PROCESSING?: boolean;

  @ApiPropertyOptional({
    description: 'Interval for processing actions in milliseconds',
    example: 10000
  })
  @IsOptional()
  ACTION_INTERVAL?: number;

  @ApiPropertyOptional({
    description: 'Post immediately without delay',
    example: false
  })
  @IsOptional()
  POST_IMMEDIATELY?: boolean;

  @ApiPropertyOptional({
    description: 'Enable Twitter Spaces',
    example: true
  })
  @IsOptional()
  TWITTER_SPACES_ENABLE?: boolean;

  @ApiPropertyOptional({
    description: 'Maximum number of actions to process at a time',
    example: 5
  })
  @IsOptional()
  MAX_ACTIONS_PROCESSING?: number;

  @ApiPropertyOptional({
    description: 'Type of action timeline',
    enum: ActionTimelineType,
    enumName: 'ActionTimelineType',
    example: ActionTimelineType.Following
  })
  @IsOptional()
  ACTION_TIMELINE_TYPE?: ActionTimelineType;

  @ApiPropertyOptional({
    description: 'HTTP proxy for Twitter requests',
    example: 'http://proxy.example.com:8080'
  })
  @IsOptional()
  @IsString()
  TWITTER_HTTP_PROXY?: string;

  @ApiPropertyOptional({
    description: 'Twitter cookies authentication token',
    example: 'auth_token_123'
  })
  @IsOptional()
  @IsString()
  TWITTER_COOKIES_AUTH_TOKEN?: string;

  @ApiPropertyOptional({
    description: 'Twitter cookies ct0 value',
    example: 'ct0_value_123'
  })
  @IsOptional()
  @IsString()
  TWITTER_COOKIES_CT0?: string;

  @ApiPropertyOptional({
    description: 'Twitter cookies guest ID',
    example: 'guest_id_123'
  })
  @IsOptional()
  @IsString()
  TWITTER_COOKIES_GUEST_ID?: string;
}

# Twitter Tweet Data Fields

This document lists all the fields that are now captured from the Twitter API JSON response and saved to the database.

## Tweet Fields Captured

### Basic Information
- `tweet_id` - Twitter tweet ID (rest_id)
- `conversation_id` - Conversation/thread ID
- `text` - Tweet text content
- `full_text` - Full tweet text (includes expanded URLs)
- `created_at` - Tweet creation timestamp
- `created_at_db` - When record was created in our database
- `updated_at` - When record was last updated

### Engagement Metrics
- `like_count` - Number of likes (favorites)
- `retweet_count` - Number of retweets
- `reply_count` - Number of replies
- `quote_count` - Number of quote tweets
- `view_count` - Number of views
- `bookmark_count` - Number of bookmarks

### Tweet Type Flags
- `is_reply` - Whether this is a reply to another tweet
- `is_retweet` - Whether this is a retweet
- `is_quote` - Whether this is a quote tweet
- `is_pinned` - Whether this tweet is pinned
- `favorited` - Whether the authenticated user favorited it
- `bookmarked` - Whether the authenticated user bookmarked it
- `retweeted` - Whether the authenticated user retweeted it

### Relationships
- `in_reply_to_tweet_id` - ID of tweet this replies to
- `in_reply_to_user_id` - User ID of tweet this replies to
- `in_reply_to_username` - Username of tweet this replies to
- `quoted_tweet_id` - ID of quoted tweet (if quote tweet)
- `retweeted_tweet_id` - ID of original tweet (if retweet)

### Metadata
- `source` - Source of tweet (e.g., "Twitter for iPhone")
- `lang` - Language code (e.g., "en")
- `display_text_range` - Array [start, end] indicating text range

### Entities (JSONB)
- `entities` - Contains:
  - `hashtags` - Array of hashtag objects
  - `urls` - Array of URL objects
  - `user_mentions` - Array of user mention objects
  - `media` - Array of media objects (basic)
  - `symbols` - Array of symbol objects
  - `timestamps` - Array of timestamp objects

- `extended_entities` - Extended media entities with full details:
  - Full media URLs
  - Media dimensions
  - Video information
  - Additional media metadata

### Media Information
- `has_media` - Boolean indicating if tweet has media
- `media_count` - Number of media items
- `media_types` - Array of media types: `['photo', 'video', 'animated_gif']`
- `media_urls` - Array of media URLs

### Edit Control
- `is_edit_eligible` - Whether tweet can be edited
- `editable_until_msecs` - Timestamp until which tweet can be edited
- `edits_remaining` - Number of edits remaining
- `edit_tweet_ids` - Array of tweet IDs in edit chain

### Views
- `views_state` - Views state: "EnabledWithCount", "Enabled", etc.
- `view_count` - Number of views (if available)

### Note Tweets (Long-form Content)
- `is_note_tweet` - Whether this is a note tweet (long-form)
- `note_tweet_text` - Long-form content text

### Raw Data
- `raw_json` - Complete raw JSON response from Twitter API (for reference)

## Example Tweet Data Structure

```json
{
  "tweet_id": "2007812723439235464",
  "conversation_id": "2007812723439235464",
  "text": "Yes, at massive scale!...",
  "full_text": "Yes, at massive scale!\n\nIt is the biggest vote-buying fraud scheme in the history of America.",
  "created_at": "2026-01-04T09:25:52Z",
  "like_count": 159070,
  "retweet_count": 38506,
  "reply_count": 9785,
  "quote_count": 1041,
  "view_count": 28888248,
  "bookmark_count": 9561,
  "is_reply": false,
  "is_retweet": false,
  "is_quote": true,
  "is_pinned": true,
  "favorited": false,
  "bookmarked": false,
  "retweeted": false,
  "quoted_tweet_id": "2007745285183668631",
  "source": "<a href=\"http://twitter.com/download/iphone\" rel=\"nofollow\">Twitter for iPhone</a>",
  "lang": "en",
  "display_text_range": [0, 280],
  "entities": {
    "hashtags": [],
    "urls": [],
    "user_mentions": [],
    "media": [...]
  },
  "has_media": true,
  "media_count": 1,
  "media_types": ["photo"],
  "media_urls": ["https://pbs.twimg.com/media/..."],
  "is_edit_eligible": true,
  "editable_until_msecs": 1767538431000,
  "edits_remaining": 5,
  "edit_tweet_ids": ["2007812723439235464"],
  "views_state": "EnabledWithCount",
  "is_note_tweet": false,
  "note_tweet_text": null
}
```

## Database Schema

All these fields are stored in the `twitter_tweets` table. The schema is optimized with:

- Indexes on frequently queried fields (tweet_id, profile_id, created_at, etc.)
- Partial indexes on boolean flags (is_pinned, has_media, etc.)
- JSONB for flexible entity storage
- Array types for media_types, media_urls, edit_tweet_ids

## Usage

When parsing tweets from the scraped JSON data, all these fields are automatically extracted and saved. The parsing logic handles:

- Nested structures (entities, extended_entities)
- Different tweet types (regular, reply, retweet, quote)
- Media detection and extraction
- Edit control information
- Note tweets (long-form content)
- Pinned status detection

All data is preserved in the `raw_json` field for reference and future enhancements.






















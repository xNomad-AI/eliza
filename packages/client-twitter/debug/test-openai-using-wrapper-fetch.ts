import { wrapperFetchFunction } from '../packages/client-twitter/src/scraper';

const proxyUrl = process.env.TWITTER_HTTP_PROXY;

async function start() {
  /**
   * curl "https://api.openai.com/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer xx" \
    -d '{
        "model": "gpt-4o-mini",
        "messages": [
            {
                "role": "system",
                "content": "You are a helpful assistant."
            },
            {
                "role": "user",
                "content": "Write a haiku that explains the concept of recursion."
            }
        ]
    }'
   */
  return wrapperFetchFunction(proxyUrl)(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant.',
          },
          {
            role: 'user',
            content: 'Write a haiku that explains the concept of recursion.',
          },
        ],
      }),
    },
  );
}

start().then(console.log).catch(console.error);

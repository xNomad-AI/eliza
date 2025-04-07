import {
  Logger,
} from '../settings/external.js';

interface TokenTweet {
  id: number;
  token_address: string;
  symbol: string;
  network: string;
  text: string;
  favorite_count: number;
  quote_count: number;
  reply_count: number;
  retweet_count: number;
}

interface TokenInfo {
  address: string;
  symbol: string;
}

// https://api.pump.news/api-endpoints/#/
class PumpNewsTwitterDataFetcher {
  private logger = Logger.child({
    name: PumpNewsTwitterDataFetcher.name,
  });

  constructor(private apiKey: string) {}

  async fetchTweets(tokenInfo: TokenInfo): Promise<string[]> {
    this.logger.debug(`fetchTweets: ${tokenInfo.symbol}`);
    const url = `https://api.pump.news/tweets/list?tokenAddress=${tokenInfo.address}&pageSize=20`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: '*/*',
          apikey: this.apiKey,
        },
      });
      const result = await response.json();

      if (result.status === "error") {
        this.logger.error(`Error fetching pump news: ${JSON.stringify(result)}`);
        return [];
      }
      const tweets: TokenTweet[] = result.data.tweets;
      return tweets.map((tweet) => tweet.text);
    } catch (e) {
      this.logger.error(`Error fetching pump news: ${e}`);
      return [];
    }
  }
}

class TwitterapiTwitterDataFetcher {
  private logger = Logger.child({
    name: PumpNewsTwitterDataFetcher.name,
  });

  constructor(private apiKey: string) {}

  async fetchTweets(tokenInfo: TokenInfo): Promise<string[]> {
    this.logger.debug(`fetchTweets: ${tokenInfo.symbol}`);
    const options = {method: 'GET', headers: {'X-API-Key': this.apiKey}};

    const url = `https://api.twitterapi.io/twitter/tweet/advanced_search?queryType=Latest&query=$${tokenInfo.symbol}`;
    try {
      const response = await fetch(url, options);
      const result: {
        tweets: {
          type: string;
          text: string;
          id: string;
          url: string;
        }[];
        has_next_page: boolean;
        next_page: string;
      } = await response.json();

      const tweets = result.tweets;
      return tweets.map((tweet) => tweet.text);
    } catch (e) {
      this.logger.error(`fetchTweets: ${e}`);
      return [];
    }
  }
}

class TwitterDataFetcher {
  private logger = Logger.child({
    name: TwitterDataFetcher.name,
  });

  private pumpNews: PumpNewsTwitterDataFetcher;
  private twitterapi: TwitterapiTwitterDataFetcher;

  constructor(
    pumpNewsApiKey: string,
    twitterapiApikey: string
  ) {
    this.pumpNews = new PumpNewsTwitterDataFetcher(pumpNewsApiKey);
    this.twitterapi = new TwitterapiTwitterDataFetcher(twitterapiApikey);
  }

  async fetchTweets(tokenInfo: TokenInfo): Promise<string[]> {
    const requiredTweetsNum = 8;

    const text: string[] = await this.pumpNews.fetchTweets(tokenInfo);
    const fetchedData: {
      pumpNews: string[],
      twitterapi: string[],
    } = {
      pumpNews: text,
      twitterapi: [],
    };

    if (fetchedData.pumpNews.length >= requiredTweetsNum) {
      return fetchedData.pumpNews;
    }

    fetchedData.twitterapi = await this.twitterapi.fetchTweets(tokenInfo);
    if (fetchedData.twitterapi.length >= requiredTweetsNum) {
      return fetchedData.twitterapi; 
    }

    this.logger.warn(`Not enough tweets fetched from both sources. PumpNews: ${fetchedData.pumpNews.length}, TwitterAPI: ${fetchedData.twitterapi.length}`);
    return fetchedData.pumpNews;
  }
}

export { TwitterDataFetcher };

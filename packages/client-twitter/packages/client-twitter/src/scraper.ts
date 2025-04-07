import { Scraper } from 'agent-twitter-client';
import { HttpsProxyAgent } from 'https-proxy-agent';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

export type FetchParameters = [input: RequestInfo | URL, init?: RequestInit];
export interface FetchTransformOptions {
  /**
   * Transforms the request options before a request is made. This executes after all of the default
   * parameters have been configured, and is stateless. It is safe to return new request options
   * objects.
   * @param args The request options.
   * @returns The transformed request options.
   */
  request: (
    ...args: FetchParameters
  ) => FetchParameters | Promise<FetchParameters>;
  /**
   * Transforms the response after a request completes. This executes immediately after the request
   * completes, and is stateless. It is safe to return a new response object.
   * @param response The response object.
   * @returns The transformed response object.
   */
  response: (response: Response) => Response | Promise<Response>;
}

export interface ScraperOptions {
  /**
   * An alternative fetch function to use instead of the default fetch function. This may be useful
   * in nonstandard runtime environments, such as edge workers.
   */
  fetch: typeof fetch;
  /**
   * Additional options that control how requests and responses are processed. This can be used to
   * proxy requests through other hosts, for example.
   */
  transform: Partial<FetchTransformOptions>;
}

export function wrapperFetchFunction(proxyUrl?: string) {
  let agent = undefined;
  if (proxyUrl) {
    agent = new HttpsProxyAgent(proxyUrl);
  }

  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    // console.log(input);
    // console.log(init.headers);

    /**
     * // Object.fromEntries(init.headers as any)
     *  headers: _Headers {
          [Symbol(normalizedHeaders)]: {
            authorization: 'Bearer xx',
            cookie: 'xx',
            'x-csrf-token': 'xx'
          },
          [Symbol(rawHeaderNames)]: Map(3) {
            'authorization' => 'authorization',
            'cookie' => 'cookie',
            'x-csrf-token' => 'x-csrf-token'
          }
        }
    */
    let headers: Record<string, string> = undefined;
    try {
      if (init?.headers) headers = Object.fromEntries(init.headers as any);
    } catch (error) {
      if (
        error.toString() ===
        'TypeError: object is not iterable (cannot read property Symbol(Symbol.iterator))'
      ) {
        headers = init?.headers as any;
      } else {
        // console.log(error)
        throw error;
      }
    }

    // console.log(headers);

    const params: AxiosRequestConfig = {
      url: input.toString(),
      method: init?.method || 'GET',
      headers,
      data: init?.body,
      httpsAgent: agent,
    };

    // console.log(params)

    let response: AxiosResponse;
    try {
      response = await axios.request(params);
    } catch (error) {
      // console.log(error);
      throw error;
    }

    const data =
      typeof response.data === 'object'
        ? JSON.stringify(response.data)
        : response.data;

    return new Response(data, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers as Record<string, string>),
    });
  };
}

export class CustomScraper extends Scraper {
  constructor(
    options?: Partial<ScraperOptions> | undefined,
    proxyUrl?: string,
  ) {
    super({
      fetch: wrapperFetchFunction(proxyUrl),
      // using options
      transform: options?.transform,
    });
  }
}

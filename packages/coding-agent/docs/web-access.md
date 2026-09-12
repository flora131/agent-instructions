# Fetching web content

Atomic's bundled `fetch_content` tool reads webpages, PDFs, GitHub repositories, YouTube videos, and local video files.

## Arguments

Always pass the lowercase `urls` field as a nonempty array of strings, even for one URL:

```json
{"urls": ["https://example.com/article"]}
```

For multiple pages:

```json
{"urls": ["https://example.com/one", "https://example.com/two"]}
```

For a video, include the question in `prompt`:

```json
{"urls": ["/path/to/recording.mp4"], "prompt": "What error appears on screen?"}
```

Existing prompts or integrations using `{"url": "..."}` must change to `{"urls": ["..."]}`. The singular `url` field is no longer accepted by `fetch_content`. This does not change the `url` selector on `get_search_content`.

Atomic can normalize a scalar `urls` string into a one-item array. Always use the documented array form in prompts and integrations; the legacy `url` field is not normalized.

## Troubleshooting

If argument validation fails, check that:

- The field is `urls`, not `URLs` or `url`.
- Its value is an array, not a string or an object.
- The array contains at least one nonempty string.
- The call has no unrecognized fields.

If every URL in a batch fails, the error lists each URL and its cause. Check the URLs and retry transient failures individually with `fetch_content({ urls: ["<failed URL>"] })`. For blocked pages or repeated extraction failures, try an accessible alternate URL or use `web_search`. `get_search_content` cannot recover content from a failed fetch.

When fetched content is truncated, follow the returned `get_search_content` call to retrieve the stored content.

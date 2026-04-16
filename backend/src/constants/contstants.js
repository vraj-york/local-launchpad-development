export const API_BASE_URLS = Object.freeze({
  GITHUB: "https://api.github.com",
  BITBUCKET: "https://api.bitbucket.org/2.0",
  ATLASSIAN: "https://api.atlassian.com",
  CURSOR: "https://api.cursor.com",
  OPENAI: "https://api.openai.com",
});

export const API_ENDPOINTS = Object.freeze({
  BITBUCKET_OAUTH_TOKEN: "https://bitbucket.org/site/oauth2/access_token",
  OPENAI_CHAT_COMPLETIONS: "https://api.openai.com/v1/chat/completions",
});

export const WEBHOOK_PATHS = Object.freeze({
  GITHUB_PUSH: "/api/webhooks/github/push",
  BITBUCKET_PUSH: "/api/webhooks/bitbucket/push",
});

export const GIT_SHA_REGEX = /^[0-9a-f]{7,40}$/i;

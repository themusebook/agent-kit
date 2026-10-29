/** OpenAI SDK + Vercel AI SDK providers backed by a guarded x402 fetch. */
import { METAPLEX_X402_BASE_URL } from "@metaplex-foundation/x402";

/** new OpenAI(openAIOptions(fetchWithPayment)) */
export function openAIOptions(fetchWithPayment: typeof fetch, baseURL = METAPLEX_X402_BASE_URL) {
  // The gateway authenticates by payment; the SDK just needs a non-empty key.
  return { apiKey: "x402", baseURL, fetch: fetchWithPayment };
}

/** Vercel AI SDK: createOpenAICompatible(vercelProviderOptions(fetchWithPayment)) */
export function vercelProviderOptions(fetchWithPayment: typeof fetch, baseURL = METAPLEX_X402_BASE_URL) {
  return { name: "metaplex-x402", apiKey: "x402", baseURL, fetch: fetchWithPayment };
}

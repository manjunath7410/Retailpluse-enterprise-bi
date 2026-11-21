const MODEL_NAME = 'gemini-4-hydrogen';

export function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key !== 'MY_GEMINI_API_KEY' && key.trim().length > 5);
}

export function getGeminiModelName(): string {
  return MODEL_NAME;
}

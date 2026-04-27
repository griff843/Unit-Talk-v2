export function normalizeManifestContent(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

export function manifestContentsMatch(existingContent: string, nextContent: string): boolean {
  return normalizeManifestContent(existingContent) === normalizeManifestContent(nextContent);
}

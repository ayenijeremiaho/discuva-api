// A tag is stored in the text as @[Name](memberId) or @[team](team), and shown as @Name.
const TOKEN = /@\[([^\]]{1,80})\]\(([0-9a-f-]{36}|team)\)/gi;
export const TEAM_TAG = 'team';
export const MAX_TAGGED_PEOPLE = 10;

export function plainText(body: string): string {
  return body.replace(TOKEN, '@$1');
}

export function parseMentions(body: string): {
  memberIds: string[];
  team: boolean;
} {
  const memberIds = new Set<string>();
  let team = false;
  for (const [, , target] of body.matchAll(TOKEN)) {
    if (target === TEAM_TAG) team = true;
    else memberIds.add(target.toLowerCase());
  }
  return { memberIds: [...memberIds], team };
}

// The label comes from our own records, so a tag can't show one name and notify another person.
export function rewriteMentions(
  body: string,
  names: Map<string, string>,
  allowTeam: boolean,
): string {
  return body.replace(TOKEN, (_all, label: string, target: string) => {
    if (target === TEAM_TAG) {
      return allowTeam ? `@[${TEAM_TAG}](${TEAM_TAG})` : `@${TEAM_TAG}`;
    }
    const name = names.get(target.toLowerCase())?.replace(/[[\]()]/g, '');
    return name ? `@[${name}](${target.toLowerCase()})` : `@${label}`;
  });
}

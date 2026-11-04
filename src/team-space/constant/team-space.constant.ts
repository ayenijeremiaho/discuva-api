export const POST_MAX_LENGTH = 2000;
export const REPLY_MAX_LENGTH = 1000;
export const POST_TITLE_MAX_LENGTH = 120;
export const REASON_MAX_LENGTH = 300;
// One report push to moderators per space in this window.
export const REPORT_PUSH_THROTTLE_SECONDS = 15 * 60;
export const MUTE_DAYS = [1, 7, 30];
export const REPORTS_PAGE_SIZE = 20;
// Room for stored tags; the visible text is checked against the limits above.
export const TAG_ALLOWANCE = 800;
export const FEED_PAGE_SIZE = 20;
export const REPLY_PAGE_SIZE = 50;
export const MAX_PINNED = 3;
// Unread counts stop here ("99+"), so counting never scans a long history.
export const UNREAD_CAP = 99;
// One reply notification per post in this window, so a busy thread doesn't buzz its author nonstop.
export const REPLY_PUSH_THROTTLE_SECONDS = 30 * 60;
// The evening summary goes out at this hour, church time.
export const DIGEST_HOUR = 18;
export const ADULT_AGE = 18;
// Defaults for volunteering spaces (churches can change them): takes new posts until this many days after the event, then stays readable.
export const VOLUNTEER_SPACE_OPEN_DAYS = 3;
// ...and is listed until this many days after the event.
export const VOLUNTEER_SPACE_LISTED_DAYS = 14;

# Stage 4 help and FAQ review — 2026-11-13

Stage 4 working branches now include the production member/worker CSV release.
The member app has no admin-export release note or export controls. The network
feature remains subject to its rollout switch and prerequisite sign-in/profile
settings; this review does not switch anything on or publish Stage 4.

| Surface | Coverage |
| --- | --- |
| Admin Members / Workers Help | Email CSV; all filtered rows across pages and above 1,000; core/optional fields; independent shared organisation defaults; one-off selections; reset; recipient; queue confirmation; plan and permission requirements |
| Admin Members Help | Move requests, historical moved records, and where members update emergency contacts |
| Admin Attendance Help | Network visitors, venue code/poster, host privacy and home attendance elsewhere |
| Admin Events / Announcements Help | Send to all branches, marked copies, source edits/cancellation and local hiding |
| Admin Church Network Help | Eligibility and rollout prerequisites, stable addresses, level labels, giving sharing, aggregate figures, overseers, read-only limits, closing and cancellation |
| Admin Network Report Help | Dedicated exact-route entry; month/snapshot freshness, small-count masking, per-100 figures, median, attention thresholds, final months and emailed reports |
| Admin Network Agenda Help | Dedicated exact-route entry; week/branch filters and marked shared events |
| Member searchable FAQ | Network app branch choice versus membership move; worker release; sign-in/admin-access prerequisites; cancelling a pending request; arriving as a member; retained history; visitor location/venue code; attendance elsewhere; copied events; closures; optional move suggestions |
| Member profile FAQ | Saving profile changes and editing/clearing emergency contact details |
| Existing app tour | Reviewed: generic navigation, More, account preferences and searchable FAQ/replay remain accurate; network actions are explained in the FAQ rather than adding steps for users without networks |
| Platform console | Existing Networks inline help states structure/figures only and points staff to Church Networks under Platform Settings; technical rollout/limits remain in TECH_DOC and the Stage 4 design note |
| Public website FAQ | Existing general multi-branch answer does not describe these unreleased workflows; no expanded Stage 4 marketing claims added in this review |

Member network FAQs appear only when the existing public-network context provides
more than one branch, matching the account's branch actions. They require no new
API calls. The FAQ search indexes questions and answers as before. Admin report
and agenda entries override the generic network help through the existing route
lookup. All new account-type-sensitive text follows the wording helper.

The production export component's Stage 4 integration restores the network
read-only context. It hides export actions in overseer/closed-branch views,
matching the API's refusal of POST exports there, and retains member-edit
permission for changing shared defaults. It does not change production master.

No schema, endpoint, index, background job, polling or database-query changes are
introduced. The only runtime addition to the member FAQ is reading the existing
tenant context. The website's pre-existing local next-env.d.ts modification was
left untouched. Nothing in this review accesses production member data.

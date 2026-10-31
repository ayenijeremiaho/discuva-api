# Ownership recovery

For when an account's owners are gone or won't respond. Discuva staff run this by hand until it has its own screens.

## 1. Check the request
Ask leadership for all of these:
- A letter on the organisation's letterhead, signed by its senior leader or board, naming the new owner.
- A message from the organisation's contact email or its domain.
- The new owner must already be an admin, or be added as one.

For a small group without letterhead or a domain, ask for a message from its known leader or contact details, plus confirmation from another known member.

## 2. Tell everyone, then wait
Email the current owners and the contact address, saying what was requested and that anyone can object. Wait 14 days. Record the dates.

## 3. Decide
- **No valid objection:** make the change (step 4).
- **Any objection:** freeze. Make no ownership change and leave access as it is. Follow the organisation's governing body or a legal ruling. Discuva doesn't pick a side.

## 4. Make the change
With a second person checking, in that tenant's schema:

```sql
UPDATE admins SET is_owner = true, owner_invited_at = NULL, owner_invited_by_id = NULL WHERE id = '<new owner admin id>';
```

To also remove an unreachable owner:

```sql
UPDATE admins SET is_owner = false WHERE id = '<old owner admin id>';
```

Leave at least one active owner.

## 5. Close it
Email the new owner, former owners and the contact address. Keep the letter, messages, dates and who made the change.

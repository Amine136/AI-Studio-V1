# Vibecraft MVP Rules

This file is the short operational version of the current MVP rules.

## Product Rules

- Quick workflow: direct generation
- Smart workflow: analysis, review, then generation
- Smart analysis has a fixed fee
- Generation uses model pricing with backend-enforced minimum floors

## Current Cost Floors

- Text generation minimum cost: 0.01 credits
- Image generation minimum cost: 0.10 credits

## Current Account Usage Rules

- First 24 hours after signup: max 1 credit total usage
- After first 24 hours: max 5 credits per rolling 24 hours

## Current Credit Code Rules

- Max 4 redeemed codes per account per day
- Max 10 redeemed codes per account per 7 days

These code redemption caps should be enforced in backend logic before public launch if they are approved as final MVP rules.

## Current Anti-Abuse Controls

- user and IP rate limits on generation
- separate limits for Quick and Smart
- pending Smart review cap per user
- stale Smart review expiry
- upload byte-size and resolution limits
- upload user and IP rate limits
- backend validation for uploaded image type
- admin session cookies with explicit CSRF protection

## Notes

- System-generated abuse logs are stored but hidden from the normal admin log stream.
- Catalog underpricing warnings are shown in the admin dashboard Warnings section.

-- Wayne's contact details for drafts and the digest (only fills blanks; anything set in the app wins).
UPDATE settings SET value = value || '{"full":"Wayne Harris","phone":"941-877-5624","email":"wayne@themotorcoachstore.com"}'::jsonb
WHERE key = 'buyer' AND (COALESCE(value->>'phone','') = '' OR value->>'email' IS NULL);

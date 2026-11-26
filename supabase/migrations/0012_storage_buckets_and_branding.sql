-- ============================================================================
-- Phase 2 / Milestone M12.5: Multi-Tenant Storage Buckets & RLS Policies
--   1. institution-branding  (Public Read, Admin Write: top-left logo, top-right logo, watermark)
--   2. tenant-private-assets (Private Signed URLs: COE/Principal signatures & student photos)
-- ============================================================================

-- 1. Safe UUID parser for Storage folder path checks (prevents cast errors on malformed paths)
CREATE OR REPLACE FUNCTION public.try_parse_uuid(p_text text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_text IS NULL OR p_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN p_text::uuid;
END;
$$;

-- 2. Create Storage Buckets (Idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'institution-branding',
  'institution-branding',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tenant-private-assets',
  'tenant-private-assets',
  false,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 3. Storage RLS Policies: institution-branding (Public Read, Institution Admin Write)
DROP POLICY IF EXISTS branding_objects_public_select ON storage.objects;
CREATE POLICY branding_objects_public_select ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'institution-branding');

DROP POLICY IF EXISTS branding_objects_admin_insert ON storage.objects;
CREATE POLICY branding_objects_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'institution-branding'
    AND (
      public.is_platform_admin()
      OR (
        public.try_parse_uuid((storage.foldername(name))[1]) IS NOT NULL
        AND public.is_institution_admin(public.try_parse_uuid((storage.foldername(name))[1]))
      )
    )
  );

DROP POLICY IF EXISTS branding_objects_admin_update ON storage.objects;
CREATE POLICY branding_objects_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'institution-branding'
    AND (
      public.is_platform_admin()
      OR (
        public.try_parse_uuid((storage.foldername(name))[1]) IS NOT NULL
        AND public.is_institution_admin(public.try_parse_uuid((storage.foldername(name))[1]))
      )
    )
  )
  WITH CHECK (
    bucket_id = 'institution-branding'
    AND (
      public.is_platform_admin()
      OR (
        public.try_parse_uuid((storage.foldername(name))[1]) IS NOT NULL
        AND public.is_institution_admin(public.try_parse_uuid((storage.foldername(name))[1]))
      )
    )
  );

DROP POLICY IF EXISTS branding_objects_admin_delete ON storage.objects;
CREATE POLICY branding_objects_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'institution-branding'
    AND (
      public.is_platform_admin()
      OR (
        public.try_parse_uuid((storage.foldername(name))[1]) IS NOT NULL
        AND public.is_institution_admin(public.try_parse_uuid((storage.foldername(name))[1]))
      )
    )
  );

-- 4. Storage RLS Policies: tenant-private-assets (Signed URLs Only)
--    /signatures/ subfolder -> COE / Principal / Institution Admin only
--    /students/ subfolder   -> Tenant Members can view; Academic/Exam Managers can write
DROP POLICY IF EXISTS private_assets_select ON storage.objects;
CREATE POLICY private_assets_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'tenant-private-assets'
    AND (
      public.is_platform_admin()
      OR (
        public.try_parse_uuid((storage.foldername(name))[1]) IS NOT NULL
        AND CASE
          WHEN lower(COALESCE((storage.foldername(name))[2], '')) = 'signatures'
            THEN public.is_institution_admin(public.try_parse_uuid((storage.foldername(name))[1]))
          ELSE public.is_platform_staff()
            OR public.is_institution_member(public.try_parse_uuid((storage.foldername(name))[1]))
        END
      )
    )
  );

DROP POLICY IF EXISTS private_assets_insert ON storage.objects;
CREATE POLICY private_assets_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'tenant-private-assets'
    AND (
      public.is_platform_admin()
      OR (
        public.try_parse_uuid((storage.foldername(name))[1]) IS NOT NULL
        AND CASE
          WHEN lower(COALESCE((storage.foldername(name))[2], '')) = 'signatures'
            THEN public.is_institution_admin(public.try_parse_uuid((storage.foldername(name))[1]))
          ELSE public.can_manage_academics(public.try_parse_uuid((storage.foldername(name))[1]))
        END
      )
    )
  );

DROP POLICY IF EXISTS private_assets_update ON storage.objects;
CREATE POLICY private_assets_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'tenant-private-assets'
    AND (
      public.is_platform_admin()
      OR (
        public.try_parse_uuid((storage.foldername(name))[1]) IS NOT NULL
        AND CASE
          WHEN lower(COALESCE((storage.foldername(name))[2], '')) = 'signatures'
            THEN public.is_institution_admin(public.try_parse_uuid((storage.foldername(name))[1]))
          ELSE public.can_manage_academics(public.try_parse_uuid((storage.foldername(name))[1]))
        END
      )
    )
  )
  WITH CHECK (
    bucket_id = 'tenant-private-assets'
    AND (
      public.is_platform_admin()
      OR (
        public.try_parse_uuid((storage.foldername(name))[1]) IS NOT NULL
        AND CASE
          WHEN lower(COALESCE((storage.foldername(name))[2], '')) = 'signatures'
            THEN public.is_institution_admin(public.try_parse_uuid((storage.foldername(name))[1]))
          ELSE public.can_manage_academics(public.try_parse_uuid((storage.foldername(name))[1]))
        END
      )
    )
  );

DROP POLICY IF EXISTS private_assets_delete ON storage.objects;
CREATE POLICY private_assets_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'tenant-private-assets'
    AND (
      public.is_platform_admin()
      OR (
        public.try_parse_uuid((storage.foldername(name))[1]) IS NOT NULL
        AND CASE
          WHEN lower(COALESCE((storage.foldername(name))[2], '')) = 'signatures'
            THEN public.is_institution_admin(public.try_parse_uuid((storage.foldername(name))[1]))
          ELSE public.is_institution_admin(public.try_parse_uuid((storage.foldername(name))[1]))
        END
      )
    )
  );

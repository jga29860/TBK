-- TBK : contrôles de diagnostic en lecture seule
-- À exécuter dans l’éditeur SQL Supabase avec un compte autorisé.

-- 1. Présence des tables utilisées par les modules
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'club_seasons','registrations','registration_settings','registration_columns',
    'tbk_profiles','tbk_user_profiles','tbk_pages','tbk_profile_page_permissions'
  )
order by table_name;

-- 2. Vérification des colonnes d’audit et de leur type
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('registrations','registration_settings')
  and column_name in ('updated_by','updated_at')
order by table_name, column_name;

-- 3. État de la sécurité RLS
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'club_seasons','registrations','registration_settings','registration_columns',
    'tbk_profiles','tbk_user_profiles','tbk_pages','tbk_profile_page_permissions'
  )
order by tablename;

-- 4. Politiques RLS déclarées. Ce contrôle ne modifie aucune politique.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'club_seasons','registrations','registration_settings','registration_columns',
    'tbk_profiles','tbk_user_profiles','tbk_pages','tbk_profile_page_permissions'
  )
order by tablename, policyname;

-- 5. Cohérence des profils applicatifs avec les utilisateurs Auth
select p.user_id, p.login_name, p.display_name, p.email, p.profile_code, p.active,
       case when u.id is null then 'AUTH MANQUANT' else 'OK' end as auth_status
from public.tbk_user_profiles p
left join auth.users u on u.id = p.user_id
order by p.display_name nulls last, p.login_name;

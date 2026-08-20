-- TBK V125 - Réparation du profil administrateur manquant
-- 1) Remplacez l'adresse ci-dessous par l'email Auth de l'administrateur.
-- 2) Exécutez ce script dans Supabase SQL Editor.

begin;

insert into public.tbk_user_profiles
  (user_id, login_name, display_name, email, profile_code, active)
select
  u.id,
  coalesce(nullif(u.raw_user_meta_data->>'login_name',''), split_part(u.email,'@',1)),
  coalesce(nullif(u.raw_user_meta_data->>'display_name',''), u.email),
  u.email,
  'administrateur',
  true
from auth.users u
where lower(u.email)=lower('REMPLACER_PAR_EMAIL_ADMIN')
on conflict (user_id) do update set
  profile_code='administrateur',
  active=true,
  email=excluded.email,
  updated_at=now();

insert into public.tbk_profile_page_permissions(profile_code,page_key,can_view,updated_at)
select 'administrateur',p.page_key,true,now()
from public.tbk_pages p
where p.active=true
on conflict (profile_code,page_key) do update set can_view=true,updated_at=now();

commit;

-- Contrôle
select u.id,u.email,p.profile_code,p.active
from auth.users u
left join public.tbk_user_profiles p on p.user_id=u.id
where lower(u.email)=lower('REMPLACER_PAR_EMAIL_ADMIN');

select u.id,u.email,p.login_name,p.display_name,p.profile_code,p.active
from auth.users u
left join public.tbk_user_profiles p on p.user_id=u.id
order by u.email;

select profile_code,page_key,can_view
from public.tbk_profile_page_permissions
where profile_code='administrateur'
order by page_key;

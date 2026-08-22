begin;

create or replace function public.delete_clan_member_attack_history(
  p_source public.clan_source,
  p_clanid text,
  p_membersource public.clan_source,
  p_memberid text,
  p_day date,
  p_history_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  removed_sortie integer;
  removed_overtime integer;
  changed_at timestamptz := now();
begin
  select sortie, overtime
  into removed_sortie, removed_overtime
  from public.attack_histories
  where id = p_history_id
    and source = p_source
    and clanid = p_clanid
    and membersource = p_membersource
    and memberid = p_memberid
    and day = p_day
  for update;

  if removed_sortie is null then
    raise exception 'Attack history was not found';
  end if;

  if removed_overtime > 0 and exists (
    select 1
    from public.attack_histories
    where id <> p_history_id
      and source = p_source
      and clanid = p_clanid
      and membersource = p_membersource
      and memberid = p_memberid
      and day = p_day
      and sortie = removed_sortie
  ) then
    raise exception 'Carry-over source history cannot be deleted after use';
  end if;

  delete from public.attack_histories
  where id = p_history_id;

  if not exists (
    select 1
    from public.attack_histories
    where source = p_source
      and clanid = p_clanid
      and membersource = p_membersource
      and memberid = p_memberid
      and day = p_day
      and sortie = removed_sortie
  ) then
    update public.attack_histories
    set sortie = sortie - 1,
        updatetime = changed_at
    where source = p_source
      and clanid = p_clanid
      and membersource = p_membersource
      and memberid = p_memberid
      and day = p_day
      and sortie > removed_sortie;
  end if;
end;
$$;

revoke all on function public.delete_clan_member_attack_history(
  public.clan_source, text, public.clan_source, text, date, bigint
) from public, anon, authenticated;

grant execute on function public.delete_clan_member_attack_history(
  public.clan_source, text, public.clan_source, text, date, bigint
) to service_role;

commit;

notify pgrst, 'reload schema';
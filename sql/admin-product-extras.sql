-- MILA CAFÉ: fases B/C. Ejecutar SOLO por el propietario en Supabase.
-- No cambia login, redeem_order, admin_* existentes ni triggers/cashback.
begin;

do $$
begin
  if to_regprocedure('public._check_admin(uuid,text)') is null then
    raise exception 'Falta _check_admin(uuid,text). No se ha cambiado nada; revisa las funciones de PIN existentes.';
  end if;
end $$;

-- Fotografías/opciones son referencias del catálogo. Las líneas conservan
-- una copia de lo elegido para que editar el catálogo no altere pedidos viejos.
alter table public.order_items
  add column if not exists opciones jsonb not null default '[]'::jsonb,
  add column if not exists notas text not null default '',
  add column if not exists alergias text[] not null default '{}'::text[];
alter table public.orders add column if not exists alergias text;
alter table public.product_option_groups
  add column if not exists activo boolean not null default true;

-- Permitir varias líneas del mismo producto, con opciones/notas distintas.
-- Solo elimina una restricción sobre EXACTAMENTE (order_id, product_id),
-- si existe. No elimina filas ni cambia otras restricciones.
do $$
declare r record;
begin
  for r in
    select c.conname, c.contype
    from pg_constraint c
    where c.conrelid = 'public.order_items'::regclass
      and c.contype in ('u','p')
      and (select array_agg(a.attname::text order by a.attname::text)
           from pg_attribute a
           where a.attrelid = c.conrelid and a.attnum = any(c.conkey))
          = array['order_id','product_id']::text[]
  loop
    execute format('alter table public.order_items drop constraint %I', r.conname);
    if r.contype = 'p' then
      alter table public.order_items alter column id set not null;
      alter table public.order_items add primary key (id);
    end if;
  end loop;
  for r in
    select ns.nspname, ci.relname
    from pg_index i
    join pg_class ci on ci.oid = i.indexrelid
    join pg_namespace ns on ns.oid = ci.relnamespace
    where i.indrelid = 'public.order_items'::regclass and i.indisunique
      and i.indnkeyatts=2 and i.indnatts=2 and i.indexprs is null
      and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
      and (select array_agg(a.attname::text order by a.attname::text)
           from pg_attribute a
           where a.attrelid = i.indrelid and a.attnum = any(i.indkey::smallint[]))
          = array['order_id','product_id']::text[]
  loop
    execute format('drop index %I.%I', r.nspname, r.relname);
  end loop;
end $$;

-- No abrir escritura directa en las tablas nuevas.
alter table public.product_images enable row level security;
alter table public.option_groups enable row level security;
alter table public.options enable row level security;
alter table public.product_option_groups enable row level security;
revoke insert, update, delete on public.product_images, public.option_groups,
  public.options, public.product_option_groups from public, anon, authenticated;
grant select on public.product_images, public.option_groups,
  public.options, public.product_option_groups to anon, authenticated;
-- Se conservan las políticas de lectura pública que ya creaste.

-- La foto principal es la primera por orden (y se sincroniza image_url).
create or replace function public.admin_add_product_image(
  p_admin_id uuid, p_pin text, p_product_id uuid, p_url text
) returns jsonb language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_error text; v_current text; v_count integer; v_order integer;
begin
  v_error := public._check_admin(p_admin_id, p_pin);
  if v_error is not null then return jsonb_build_object('ok',false,'error',v_error); end if;
  if coalesce(btrim(p_url),'') = '' or p_url not like 'https://%' then
    return jsonb_build_object('ok',false,'error','La URL de la foto no es válida');
  end if;
  select image_url into v_current from public.products where id=p_product_id for update;
  if not found then return jsonb_build_object('ok',false,'error','Producto no encontrado'); end if;
  select count(*) into v_count from public.product_images where product_id=p_product_id;
  if exists (select 1 from public.product_images where product_id=p_product_id and url=p_url) then
    return jsonb_build_object('ok',false,'error','Esta foto ya está agregada');
  end if;
  if v_count = 0 and nullif(btrim(v_current),'') is not null and v_current <> p_url then
    -- Al empezar una galería se conserva la foto actual como primera.
    insert into public.product_images(id,product_id,url,orden)
    values(gen_random_uuid(),p_product_id,v_current,0);
    v_count := 1;
  end if;
  if v_count >= 5 then return jsonb_build_object('ok',false,'error','Máximo 5 fotos por producto'); end if;
  select coalesce(max(orden),-1)+1 into v_order from public.product_images where product_id=p_product_id;
  insert into public.product_images(id,product_id,url,orden)
  values(gen_random_uuid(),p_product_id,p_url,v_order);
  update public.products set image_url=(
    select url from public.product_images where product_id=p_product_id order by orden,id limit 1
  ) where id=p_product_id;
  return jsonb_build_object('ok',true,'data',(
    select coalesce(jsonb_agg(to_jsonb(i) order by i.orden,i.id),'[]'::jsonb)
    from public.product_images i where i.product_id=p_product_id
  ));
end $$;

create or replace function public.admin_delete_product_image(
  p_admin_id uuid, p_pin text, p_product_id uuid, p_image_id uuid
) returns jsonb language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_error text;
begin
  v_error := public._check_admin(p_admin_id, p_pin);
  if v_error is not null then return jsonb_build_object('ok',false,'error',v_error); end if;
  perform 1 from public.products where id=p_product_id for update;
  if not found then return jsonb_build_object('ok',false,'error','Producto no encontrado'); end if;
  delete from public.product_images where id=p_image_id and product_id=p_product_id;
  if not found then return jsonb_build_object('ok',false,'error','Foto no encontrada en este producto'); end if;
  update public.products set image_url=(
    select url from public.product_images where product_id=p_product_id order by orden,id limit 1
  ) where id=p_product_id;
  return jsonb_build_object('ok',true,'data',(
    select coalesce(jsonb_agg(to_jsonb(i) order by i.orden,i.id),'[]'::jsonb)
    from public.product_images i where i.product_id=p_product_id
  ));
end $$;

-- Marcar una foto como principal = colocar su id primero en p_image_ids.
create or replace function public.admin_reorder_product_images(
  p_admin_id uuid, p_pin text, p_product_id uuid, p_image_ids uuid[]
) returns jsonb language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_error text; v_count integer; v_offset integer;
begin
  v_error := public._check_admin(p_admin_id, p_pin);
  if v_error is not null then return jsonb_build_object('ok',false,'error',v_error); end if;
  perform 1 from public.products where id=p_product_id for update;
  if not found then return jsonb_build_object('ok',false,'error','Producto no encontrado'); end if;
  select count(*) into v_count from public.product_images where product_id=p_product_id;
  if v_count=0 then return jsonb_build_object('ok',false,'error','No hay fotos de galería para ordenar'); end if;
  if p_image_ids is null or cardinality(p_image_ids) <> v_count
    or (select count(distinct u.id) from unnest(p_image_ids) as u(id)) <> v_count
    or exists (select 1 from unnest(p_image_ids) as u(id) where not exists (
      select 1 from public.product_images i where i.id=u.id and i.product_id=p_product_id
    )) then
    return jsonb_build_object('ok',false,'error','Envía todos los IDs de las fotos de este producto, sin repetir');
  end if;
  -- Dos pasos evitan colisiones si existe UNIQUE(product_id,orden).
  select coalesce(max(orden),0)+v_count+1 into v_offset
  from public.product_images where product_id=p_product_id;
  update public.product_images i set orden=(v_offset+u.pos)::integer
  from unnest(p_image_ids) with ordinality as u(id,pos)
  where i.id=u.id and i.product_id=p_product_id;
  update public.product_images i set orden=(u.pos-1)::integer
  from unnest(p_image_ids) with ordinality as u(id,pos)
  where i.id=u.id and i.product_id=p_product_id;
  update public.products set image_url=(
    select url from public.product_images where product_id=p_product_id order by orden,id limit 1
  ) where id=p_product_id;
  return jsonb_build_object('ok',true,'data',(
    select coalesce(jsonb_agg(to_jsonb(i) order by i.orden,i.id),'[]'::jsonb)
    from public.product_images i where i.product_id=p_product_id
  ));
end $$;

-- Quita la principal, incluida la foto antigua sin filas de galería.
-- Si quedan fotos, la primera pasa a ser la principal.
create or replace function public.admin_clear_product_main_image(
  p_admin_id uuid, p_pin text, p_product_id uuid
) returns jsonb language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_error text; v_url text;
begin
  v_error := public._check_admin(p_admin_id, p_pin);
  if v_error is not null then return jsonb_build_object('ok',false,'error',v_error); end if;
  perform 1 from public.products where id=p_product_id for update;
  if not found then return jsonb_build_object('ok',false,'error','Producto no encontrado'); end if;
  select url into v_url from public.product_images where product_id=p_product_id order by orden,id limit 1;
  if found then delete from public.product_images where product_id=p_product_id and url=v_url; end if;
  update public.products set image_url=(
    select url from public.product_images where product_id=p_product_id order by orden,id limit 1
  ) where id=p_product_id;
  return jsonb_build_object('ok',true,'data',(
    select coalesce(jsonb_agg(to_jsonb(i) order by i.orden,i.id),'[]'::jsonb)
    from public.product_images i where i.product_id=p_product_id
  ));
end $$;

-- p_id NULL crea; p_activo=false oculta sin borrar filas.
create or replace function public.admin_save_option_group(
  p_admin_id uuid, p_pin text, p_id uuid, p_nombre text,
  p_obligatorio boolean, p_max_opciones integer, p_orden integer, p_activo boolean
) returns jsonb language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_error text; r public.option_groups;
begin
  v_error := public._check_admin(p_admin_id, p_pin);
  if v_error is not null then return jsonb_build_object('ok',false,'error',v_error); end if;
  if coalesce(btrim(p_nombre),'')='' then return jsonb_build_object('ok',false,'error','Escribe el nombre del grupo'); end if;
  if p_max_opciones is null or p_max_opciones < 1 then
    return jsonb_build_object('ok',false,'error','El máximo de opciones debe ser al menos 1');
  end if;
  if p_id is null then
    insert into public.option_groups(id,nombre,obligatorio,max_opciones,orden,activo)
    values(gen_random_uuid(),btrim(p_nombre),coalesce(p_obligatorio,false),
      p_max_opciones,coalesce(p_orden,0),coalesce(p_activo,true)) returning * into r;
  else
    update public.option_groups set nombre=btrim(p_nombre), obligatorio=coalesce(p_obligatorio,false),
      max_opciones=p_max_opciones, orden=coalesce(p_orden,0), activo=coalesce(p_activo,true)
    where id=p_id returning * into r;
    if not found then return jsonb_build_object('ok',false,'error','Grupo no encontrado'); end if;
  end if;
  return jsonb_build_object('ok',true,'data',to_jsonb(r));
end $$;

create or replace function public.admin_save_option(
  p_admin_id uuid, p_pin text, p_id uuid, p_group_id uuid,
  p_nombre text, p_precio_extra numeric, p_orden integer, p_activo boolean
) returns jsonb language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_error text; r public.options;
begin
  v_error := public._check_admin(p_admin_id, p_pin);
  if v_error is not null then return jsonb_build_object('ok',false,'error',v_error); end if;
  if coalesce(btrim(p_nombre),'')='' then return jsonb_build_object('ok',false,'error','Escribe el nombre de la opción'); end if;
  if p_precio_extra is null or p_precio_extra < 0 then
    return jsonb_build_object('ok',false,'error','El precio extra no puede ser negativo');
  end if;
  perform 1 from public.option_groups where id=p_group_id for update;
  if not found then return jsonb_build_object('ok',false,'error','Grupo no encontrado'); end if;
  if p_id is null then
    insert into public.options(id,group_id,nombre,precio_extra,orden,activo)
    values(gen_random_uuid(),p_group_id,btrim(p_nombre),p_precio_extra,
      coalesce(p_orden,0),coalesce(p_activo,true)) returning * into r;
  else
    update public.options set nombre=btrim(p_nombre), precio_extra=p_precio_extra,
      orden=coalesce(p_orden,0), activo=coalesce(p_activo,true)
    where id=p_id and group_id=p_group_id returning * into r;
    if not found then return jsonb_build_object('ok',false,'error','Opción no encontrada en este grupo'); end if;
  end if;
  return jsonb_build_object('ok',true,'data',to_jsonb(r));
end $$;

-- p_asignado=false quita el grupo del producto sin borrar ni el grupo
-- ni las opciones ni siquiera la fila de asignación.
create or replace function public.admin_set_product_option_group(
  p_admin_id uuid, p_pin text, p_product_id uuid, p_group_id uuid, p_asignado boolean
) returns jsonb language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v_error text; r public.product_option_groups;
begin
  v_error := public._check_admin(p_admin_id, p_pin);
  if v_error is not null then return jsonb_build_object('ok',false,'error',v_error); end if;
  perform 1 from public.products where id=p_product_id for update;
  if not found then return jsonb_build_object('ok',false,'error','Producto no encontrado'); end if;
  perform 1 from public.option_groups where id=p_group_id;
  if not found then return jsonb_build_object('ok',false,'error','Grupo no encontrado'); end if;
  update public.product_option_groups set activo=coalesce(p_asignado,false)
  where product_id=p_product_id and group_id=p_group_id returning * into r;
  if not found then
    insert into public.product_option_groups(product_id,group_id,activo)
    values(p_product_id,p_group_id,coalesce(p_asignado,false)) returning * into r;
  end if;
  return jsonb_build_object('ok',true,'data',to_jsonb(r));
end $$;

revoke all on function
  public.admin_add_product_image(uuid,text,uuid,text),
  public.admin_delete_product_image(uuid,text,uuid,uuid),
  public.admin_reorder_product_images(uuid,text,uuid,uuid[]),
  public.admin_clear_product_main_image(uuid,text,uuid),
  public.admin_save_option_group(uuid,text,uuid,text,boolean,integer,integer,boolean),
  public.admin_save_option(uuid,text,uuid,uuid,text,numeric,integer,boolean),
  public.admin_set_product_option_group(uuid,text,uuid,uuid,boolean)
from public, anon, authenticated;
grant execute on function
  public.admin_add_product_image(uuid,text,uuid,text),
  public.admin_delete_product_image(uuid,text,uuid,uuid),
  public.admin_reorder_product_images(uuid,text,uuid,uuid[]),
  public.admin_clear_product_main_image(uuid,text,uuid),
  public.admin_save_option_group(uuid,text,uuid,text,boolean,integer,integer,boolean),
  public.admin_save_option(uuid,text,uuid,uuid,text,numeric,integer,boolean),
  public.admin_set_product_option_group(uuid,text,uuid,uuid,boolean)
to anon, authenticated;

notify pgrst, 'reload schema';
commit;

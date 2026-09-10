{{ config(materialized='view') }}

select
    upper(trim(pc.profit_centre_code)) as profit_centre_code,
    trim(pc.profit_centre_name)        as profit_centre_name,
    upper(trim(pc.company_tla))        as company_tla,
    trim(pc.country_code)              as country_code,
    coalesce(pc.is_active, true)       as is_active
from {{ source('finance_uploads', 'config_profit_centres') }} pc
where pc.profit_centre_code is not null

union all

-- The contra-row counterparty. `Allocation trans.` writes a share -1 row
-- against profit centre '-' for every allocation, which is what makes each pool
-- net to zero. It has to exist as a member here or the fact loses rows on join.
select
    '-'                    as profit_centre_code,
    'Allocation contra'    as profit_centre_name,
    null                   as company_tla,
    null                   as country_code,
    true                   as is_active

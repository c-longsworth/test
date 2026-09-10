{{ config(materialized='view') }}

/*
    Cost centre lookup. Two flags matter downstream:
      - allocates_to_other_cost_centres: the 32 centres that feed pass 1
        (facilities 4101-4125, IT 4200 and 1500, 8010/8011 DACH/SCAND).
      - allocation_key: how the centre is emptied out to profit centres in pass 2.
*/

select
    upper(trim(cc.centre_code))      as centre_code,
    trim(cc.centre_name)             as centre_name,
    upper(trim(cc.company_tla))      as company_tla,
    trim(cc.centre_type)             as centre_type,
    upper(trim(cc.allocation_key))   as allocation_key,
    coalesce(cc.allocates_to_other_cost_centers, false) as allocates_to_other_cost_centres,
    trim(cc.default_profit_centre)   as default_profit_centre
from {{ source('finance_uploads', 'config_cost_centres') }} cc
where cc.centre_code is not null

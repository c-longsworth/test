{{ config(severity='error') }}

select
    company_tla,
    period_month,
    account_group,
    cost_centre_code,
    sum(amount) as residual
from {{ ref('int_alloc_variable_cost_keys') }}
group by 1, 2, 3, 4
having abs(sum(amount)) > 0.01
